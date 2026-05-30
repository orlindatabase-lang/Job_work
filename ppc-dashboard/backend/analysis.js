const { SCORING } = require('./config');

// ── Vendor table ranking (unchanged) ─────────────────────────────────────────
function scoreVendor(v) {
  const total        = v.issue_qty || 1;
  const completion   = (v.received_qty || 0) / total;
  const pendingRatio = (v.pending_qty  || 0) / total;
  return (completion   * SCORING.COMPLETION_WEIGHT)
       + (v.batches    * SCORING.BATCH_WEIGHT)
       - (pendingRatio * SCORING.PENDING_PENALTY)
       + ((5 - v.debit) * SCORING.DEBIT_FACTOR)
       + ((5 - v.alter) * SCORING.ALTER_FACTOR);
}

function rankVendors(vendors) {
  return vendors.map(v => ({ ...v, score: scoreVendor(v) }))
    .sort((a, b) => b.score - a.score);
}

// ── Smart Load Split ──────────────────────────────────────────────────────────

// Compute design-specific metrics for a vendor.
// Returns null if vendor has never worked on this design.
function _designStats(v, design) {
  // Match on primary design OR the full designs array (handles multi-design lots)
  const all = (v.lots || []).filter(l =>
    l.design === design ||
    (Array.isArray(l.designs) && l.designs.includes(design))
  );
  if (!all.length) return null;

  const active    = all.filter(l => (l.pending_qty  || 0) > 0);
  const completed = all.filter(l => (l.received_qty || 0) > 0 && (l.pending_qty || 0) === 0);

  const totalIssued    = all.reduce((s, l) => s + (l.issue_qty    || 0), 0);
  const pendingQty     = active.reduce((s, l) => s + (l.pending_qty || 0), 0);

  // Design-specific monthly throughput from historical lot dates
  const dates  = all.map(l => new Date(l.date)).filter(d => !isNaN(d));
  const months = dates.length > 1
    ? Math.max(0.5, (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24 * 30))
    : 1;
  const designCap = Math.round(totalIssued / months); // pcs/month for this design

  return {
    isActive:          active.length > 0,      // currently working on this design
    activeLots:        active.length,
    completedLots:     completed.length,
    pendingQty,                                 // pieces still in hand for this design
    designCap,                                  // design-specific monthly throughput
  };
}

// Rank vendors for a specific design split.
// Priority: vendors who currently have active lots > completed only > fallback all
function rankVendorsForSplit(vendors, design, expectedDays) {
  // Attach design stats to each vendor; drop vendors with no history of this design
  const withStats = vendors
    .map(v => {
      const ds = _designStats(v, design);
      return ds ? { ...v, ds } : null;
    })
    .filter(Boolean);

  const pool        = withStats.length > 0 ? withStats : vendors.map(v => ({ ...v, ds: null }));
  const designMatch = withStats.length > 0;

  const ranked = pool.map(v => {
    const ds = v.ds || { isActive: false, activeLots: 0, completedLots: 0, pendingQty: 0, designCap: v.cap };

    // 1. Active vendors get a priority bonus — they're already set up for this design
    const activeBonus = ds.isActive ? 25 : 0;

    // 2. Experience: reward vendors with more completed batches of this design
    const expScore = Math.min(25, ds.completedLots * 5);

    // 3. Speed: can they meet the deadline?
    const speedScore = expectedDays > 0
      ? ((expectedDays - v.avgDays) / Math.max(expectedDays, 1)) * 40
      : (30 - Math.min(30, v.avgDays));

    // 4. Quality
    const quality = (5 - Math.min(5, v.debit)) * 4
                  + (5 - Math.min(5, v.alter))  * 3;

    // 5. Load: penalise vendors whose design-pending already fills their capacity
    const designLoadRatio = ds.pendingQty / Math.max(ds.designCap, 1);
    const loadPenalty     = Math.min(20, designLoadRatio * 20);

    return {
      ...v,
      ds,
      score: activeBonus + expScore + speedScore + quality - loadPenalty,
    };
  }).sort((a, b) => b.score - a.score);

  return { ranked, designMatch };
}

// Split qty among up to 3 vendors based on design-specific capacity.
// Allocation = how much of this design each vendor can absorb within expectedDays,
// minus what they're already holding for this design.
function splitLoad(ranked, qty, expectedDays) {
  if (!ranked.length) return [];

  // Prefer vendors whose historical avgDays meets the deadline
  const onTime = ranked.filter(v => v.avgDays <= (expectedDays || Infinity));
  const pool   = (onTime.length > 0 ? onTime : ranked).slice(0, 3);

  // Design-specific available capacity within expectedDays
  const designAvail = v => {
    const ds        = v.ds || {};
    const dCap      = ds.designCap || v.cap || 1000;
    const canHandle = dCap * ((expectedDays || 30) / 30);   // max pieces this design in target days
    const alreadyHas = ds.pendingQty || 0;                  // already holding for this design
    return Math.max(200, canHandle - alreadyHas);
  };

  const totalAvail = pool.reduce((s, v) => s + designAvail(v), 0) || 1;

  // Cap primary at 60% so load is always distributed
  const MAX_PCT = [0.60, 0.30, 0.15];
  const rawShares = pool.map((v, i) =>
    Math.min(MAX_PCT[i], designAvail(v) / totalAvail)
  );
  const shareSum = rawShares.reduce((s, x) => s + x, 0) || 1;
  const shares   = rawShares.map(s => s / shareSum);

  let remaining = qty;

  return pool.map((v, i) => {
    const pct      = shares[i];
    const allotQty = i === pool.length - 1
      ? remaining
      : Math.min(remaining, Math.round(qty * pct));
    remaining -= allotQty;

    const role      = i === 0 ? 'primary'   : i === 1 ? 'secondary' : 'support';
    const roleLabel = i === 0 ? 'Primary'   : i === 1 ? 'Secondary' : 'Support';

    // estDays: how long to finish allotQty + existing design-pending, given design throughput
    const ds        = v.ds || {};
    const dCap      = ds.designCap || v.cap || 1000;
    const dailyRate = dCap / 30;
    const totalWork = allotQty + (ds.pendingQty || 0);
    const estDays   = Math.max(v.avgDays, Math.ceil(totalWork / dailyRate));

    return {
      ...v,
      pct,
      allotQty,
      role,
      roleLabel,
      estDays,
      isActive:          ds.isActive      || false,
      activeLots:        ds.activeLots    || 0,
      completedLots:     ds.completedLots || 0,
      pendingQty:        ds.pendingQty    || 0,
      designCap:         dCap,
    };
  });
}

module.exports = { scoreVendor, rankVendors, rankVendorsForSplit, splitLoad };
