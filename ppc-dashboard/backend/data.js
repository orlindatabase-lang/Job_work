const path = require('path');
const fs   = require('fs');

const CACHE_PATH = path.resolve(__dirname, 'cache.json');

const PROCESS_TO_JOB = {
  'Only Stitching Issue':   'stitch',
  'Cut to Stitching Issue': 'cut_stitch',
  'Cut to Pack Issue':      'cut_pack',
};

// ── Build VENDOR_DB from cache.json written by data.py ───────────────────────
// Field names match what data.py outputs after its renaming steps:
//   job_work_report: ISSUE_PROCESS, TOTAL_ISSUE_QTY, ALTER_QTY, BALANCE_QTY,
//                    DAYS_TAKEN, RATE, TOTAL_AMOUNT, PARTY_NAME, ISSUE_DATE,
//                    TOTAL_GRN_QTY, LOT_NO, DESIGN_NO, SECTION
//   debit_notes:     PARTY_NAME, Debit_Note_Amount, DEBIT_DATE
function buildVendorDB(jobWorkRows, debitRows) {
  // Per-vendor debit stats using Python-renamed fields
  const vendorDebitStats = {};
  for (const doc of debitRows) {
    const name = (doc.PARTY_NAME || '').toString().trim().toUpperCase();
    if (!name) continue;
    if (!vendorDebitStats[name]) vendorDebitStats[name] = { amount: 0, count: 0, lastDate: null };
    vendorDebitStats[name].amount += Number(doc.Debit_Note_Amount) || 0;
    vendorDebitStats[name].count  += 1;
    const d = doc.DEBIT_DATE;
    if (d && (!vendorDebitStats[name].lastDate || d > vendorDebitStats[name].lastDate))
      vendorDebitStats[name].lastDate = d;
  }

  // DESIGN_SECTIONS map
  const dsMap = {};
  for (const doc of jobWorkRows) {
    if (!doc.DESIGN_NO || !doc.SECTION) continue;
    if (!dsMap[doc.DESIGN_NO]) dsMap[doc.DESIGN_NO] = new Set();
    dsMap[doc.DESIGN_NO].add(doc.SECTION);
  }
  const DESIGN_SECTIONS = {};
  for (const [d, secs] of Object.entries(dsMap))
    DESIGN_SECTIONS[d] = [...secs].sort();

  // Per vendor-job aggregation
  const vendorMap = {};
  for (const doc of jobWorkRows) {
    const job  = PROCESS_TO_JOB[doc.ISSUE_PROCESS];
    if (!job) continue;
    const name = (doc.PARTY_NAME || '').toString().trim().toUpperCase();
    if (!name) continue;

    const key = `${name}|${job}`;
    if (!vendorMap[key]) {
      vendorMap[key] = {
        name, job,
        issue_qty: 0, received_qty: 0, pending_qty: 0,
        alter_qty: 0, total_amount: 0,
        daysList: [], rateList: [], issueDates: [],
        designs: new Set(), lots: {},
      };
    }
    const v = vendorMap[key];

    const issueQty  = Number(doc.TOTAL_ISSUE_QTY) || 0;
    const grnQty    = Number(doc.TOTAL_GRN_QTY)   || 0;
    const balQty    = Number(doc.BALANCE_QTY)      || 0;
    const daysTaken = Number(doc.DAYS_TAKEN)       || 0;
    const rate      = Number(doc.RATE)             || 0;

    v.issue_qty    += issueQty;
    v.received_qty += grnQty;
    v.pending_qty  += balQty;
    v.alter_qty    += Number(doc.ALTER_QTY)    || 0;
    v.total_amount += Number(doc.TOTAL_AMOUNT) || 0;
    if (daysTaken > 0) v.daysList.push(daysTaken);
    if (rate > 0)      v.rateList.push(rate);
    if (doc.DESIGN_NO)  v.designs.add(doc.DESIGN_NO);
    if (doc.ISSUE_DATE) v.issueDates.push(doc.ISSUE_DATE);

    if (doc.LOT_NO) {
      if (!v.lots[doc.LOT_NO]) {
        v.lots[doc.LOT_NO] = {
          lot_no:       doc.LOT_NO,
          design:       doc.DESIGN_NO || '',   // primary design (first seen)
          designs:      [],                    // all designs in this lot
          issue_qty:    0,
          pending_qty:  0,
          received_qty: 0,
          date:         doc.ISSUE_DATE ? String(doc.ISSUE_DATE).slice(0, 10) : '',
          _sizes:       new Set(),
        };
      }
      v.lots[doc.LOT_NO].issue_qty    += issueQty;
      v.lots[doc.LOT_NO].pending_qty  += balQty;
      v.lots[doc.LOT_NO].received_qty += grnQty;
      if (doc.SIZE)      v.lots[doc.LOT_NO]._sizes.add(doc.SIZE.toString().trim());
      if (doc.DESIGN_NO && !v.lots[doc.LOT_NO].designs.includes(doc.DESIGN_NO))
        v.lots[doc.LOT_NO].designs.push(doc.DESIGN_NO);
    }
  }

  // Assemble VENDOR_DB
  const VENDOR_DB = { stitch: [], cut_stitch: [], cut_pack: [] };
  for (const v of Object.values(vendorMap)) {
    const avgDays = v.daysList.length
      ? Math.round(v.daysList.reduce((a, b) => a + b, 0) / v.daysList.length) : 14;
    const avgRate = v.rateList.length
      ? Math.round(v.rateList.reduce((a, b) => a + b, 0) / v.rateList.length) : 0;
    const ds    = vendorDebitStats[v.name] || { amount: 0, count: 0, lastDate: null };
    const debit = v.total_amount > 0 && ds.amount
      ? parseFloat(Math.min(30, (ds.amount / v.total_amount) * 100).toFixed(2)) : 0;
    const alter = v.issue_qty > 0
      ? parseFloat(Math.min(30, (v.alter_qty / v.issue_qty) * 100).toFixed(2)) : 0;

    let cap = 1000;
    const dates = v.issueDates.map(d => new Date(d)).filter(d => !isNaN(d));
    if (dates.length > 1) {
      const minD   = new Date(Math.min(...dates));
      const maxD   = new Date(Math.max(...dates));
      const months = Math.max(1, (maxD - minD) / (1000 * 60 * 60 * 24 * 30));
      cap = Math.max(500, Math.round(v.issue_qty / months));
    }

    VENDOR_DB[v.job].push({
      name:            v.name,
      batches:         Object.values(v.lots).filter(l => l.pending_qty > 0).length,
      avgDays,
      invoice:         `₹${avgRate}`,
      debit,
      debit_amount:    ds.amount,
      debit_count:     ds.count,
      last_debit_date: ds.lastDate,
      alter,
      cap,
      city:         'Surat',
      issue_qty:    v.issue_qty,
      pending_qty:  v.pending_qty,
      received_qty: v.received_qty,
      designs:      [...v.designs].sort(),
      lots:         Object.values(v.lots).map(l => ({
                      lot_no:       l.lot_no,
                      design:       l.design,
                      designs:      l.designs,
                      sizes:        [...l._sizes].sort().join(', '),
                      issue_qty:    l.issue_qty,
                      pending_qty:  l.pending_qty,
                      received_qty: l.received_qty,
                      date:         l.date,
                    })),
    });
  }

  return { VENDOR_DB, DESIGN_SECTIONS };
}

// ── Read cache.json produced by data.py ──────────────────────────────────────
function loadFromCache() {
  const cache       = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  const jobWorkRows = cache.job_work_report || [];
  const debitRows   = cache.debit_notes     || [];
  console.log(`📂 Cache: ${jobWorkRows.length} job work · ${debitRows.length} debit (${cache.generated_at})`);
  return buildVendorDB(jobWorkRows, debitRows);
}

module.exports = { loadFromCache };
