// ── DATA (loaded from backend) ──
let VENDOR_DB = {};
let DESIGN_SECTIONS = {};
let DESIGN_ALL = [];

// ── LOAD DATA FROM API ──
async function loadData() {
  try {
    const [vendorsRes, designsRes, statusRes] = await Promise.all([
      fetch(CONFIG.API_BASE_URL + CONFIG.API_ROUTES.VENDORS),
      fetch(CONFIG.API_BASE_URL + CONFIG.API_ROUTES.DESIGNS),
      fetch(CONFIG.API_BASE_URL + CONFIG.API_ROUTES.STATUS),
    ]);
    VENDOR_DB = await vendorsRes.json();
    DESIGN_SECTIONS = await designsRes.json();
    DESIGN_ALL = Object.keys(DESIGN_SECTIONS);
    const status = await statusRes.json();
    _updateLiveBadge(status);
    avRender();
  } catch (err) {
    console.error('Failed to load data from backend:', err);
    _setLiveBadgeError();
  }
}

function _updateLiveBadge(status) {
  const badge = document.getElementById('live-badge');
  const synced = document.getElementById('last-synced');
  if (status.lastRefreshed) {
    const d = new Date(status.lastRefreshed);
    const label = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    if (synced) synced.textContent = `Synced ${label}`;
    if (badge) badge.title = `Last synced: ${d.toLocaleString('en-IN')}`;
  }
}

function _setLiveBadgeError() {
  const badge = document.getElementById('live-badge');
  if (badge) {
    badge.style.background = '#fee2e2';
    badge.style.color = '#dc2626';
  }
}

async function refreshData() {
  const badge = document.getElementById('live-badge');
  if (badge) badge.innerHTML = '<div class="live-dot" style="background:#f59e0b"></div> Syncing…';
  try {
    await fetch(CONFIG.API_BASE_URL + CONFIG.API_ROUTES.REFRESH, { method: 'POST' });
    await loadData();
  } catch (err) {
    console.error('Refresh failed:', err);
    _setLiveBadgeError();
  }
}

let _selectedDesign = '';
let _selectedSections = new Set();

// ── DESIGN SEARCH ──
function designSearch(q) {
  const query = q.trim().toUpperCase();
  document.getElementById('design-clear-btn').classList.toggle('show', q.length > 0);
  const filtered = query
    ? DESIGN_ALL.filter(d => d.includes(query)).slice(0, CONFIG.DEFAULTS.MAX_DROPDOWN_ITEMS)
    : DESIGN_ALL.slice(0, CONFIG.DEFAULTS.MAX_DROPDOWN_ITEMS);
  renderDesignDropdown(filtered, true);
}

function designDropdownOpen() {
  const q = document.getElementById('design-search-inp').value.trim().toUpperCase();
  const filtered = q ? DESIGN_ALL.filter(d => d.includes(q)).slice(0, CONFIG.DEFAULTS.MAX_DROPDOWN_ITEMS) : DESIGN_ALL.slice(0, CONFIG.DEFAULTS.MAX_DROPDOWN_ITEMS);
  renderDesignDropdown(filtered, true);
}

// ── FLOATING DROPDOWN (body-level, never clipped) ──
let _ddFloating = null;

function _getOrCreateFloatingDD() {
  if (!_ddFloating) {
    _ddFloating = document.createElement('div');
    _ddFloating.id = 'design-dropdown-floating';
    _ddFloating.style.cssText = `
      display:none; position:fixed; background:#fff;
      border:1.5px solid rgba(160,120,80,.18); border-radius:10px;
      box-shadow:0 8px 24px rgba(120,70,20,.15),0 2px 6px rgba(120,70,20,.08);
      z-index:99999; max-height:280px; overflow-y:auto;
      flex-direction:column; min-width:260px;
    `;
    _ddFloating.addEventListener('scroll', e => e.stopPropagation());
    document.body.appendChild(_ddFloating);
  }
  return _ddFloating;
}

function _positionFloatingDD() {
  const inp = document.getElementById('design-input-row-el') || document.querySelector('.design-input-row');
  if (!inp) return;
  const rect = inp.getBoundingClientRect();
  const dd = _getOrCreateFloatingDD();
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.left = rect.left + 'px';
  dd.style.width = rect.width + 'px';
}

function renderDesignDropdown(list, open) {
  const dd = _getOrCreateFloatingDD();
  if (!open) { dd.style.display = 'none'; return; }

  if (list.length === 0) {
    dd.innerHTML = `<div class="design-no-results">No designs found</div>`;
  } else {
    dd.innerHTML = list.map(d => {
      const secs = (DESIGN_SECTIONS[d] || []).join(', ');
      return `<div class="design-opt${d === _selectedDesign ? ' active' : ''}" onmousedown="designSelect('${d}')">
        <span>${d}</span>
        <span class="design-opt-sections">${secs}</span>
      </div>`;
    }).join('');
  }
  _positionFloatingDD();
  dd.style.display = 'flex';
  dd.style.flexDirection = 'column';
}

function designSelect(design) {
  _selectedDesign = design;
  document.getElementById('design-search-inp').value = design;
  document.getElementById('design-clear-btn').classList.add('show');
  const dd = _getOrCreateFloatingDD();
  dd.style.display = 'none';
  renderSectionTags(DESIGN_SECTIONS[design] || []);
}

function designClear() {
  _selectedDesign = '';
  _selectedSections.clear();
  document.getElementById('design-search-inp').value = '';
  document.getElementById('design-clear-btn').classList.remove('show');
  const dd = _getOrCreateFloatingDD();
  if (dd) dd.style.display = 'none';
  document.getElementById('section-tags').innerHTML = `<span class="section-empty">Select a design first</span>`;
}

function renderSectionTags(sections) {
  _selectedSections = new Set(sections); // auto-select all
  const wrap = document.getElementById('section-tags');
  if (!sections.length) {
    wrap.innerHTML = `<span class="section-empty">No sections for this design</span>`;
    return;
  }
  wrap.innerHTML = sections.map(s =>
    `<span class="section-tag selected" onclick="toggleSection('${s}')" id="sec-tag-${s}">${s}</span>`
  ).join('');
}

function toggleSection(sec) {
  if (_selectedSections.has(sec)) {
    _selectedSections.delete(sec);
    document.getElementById(`sec-tag-${sec}`).classList.remove('selected');
  } else {
    _selectedSections.add(sec);
    document.getElementById(`sec-tag-${sec}`).classList.add('selected');
  }
}

// Close floating dropdown on outside click
document.addEventListener('click', e => {
  const dd = _ddFloating;
  const wrap = document.getElementById('design-wrap');
  if (dd && !wrap?.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

// Reposition on scroll or resize
window.addEventListener('scroll', () => { if (_ddFloating && _ddFloating.style.display !== 'none') _positionFloatingDD(); }, true);
window.addEventListener('resize', () => { if (_ddFloating && _ddFloating.style.display !== 'none') _positionFloatingDD(); });

const JOB_LABELS = {
  stitch:'Only Stitch', cut_stitch:'Cut to Stitch', cut_pack:'Cut to Pack', fob:'FoB'
};

let selectedJob = null;

// ── ALL-VENDORS PANEL ──
let _avJob = 'all';
let _avSortCol    = CONFIG.DEFAULTS.SORT_COL;
let _avSortDir    = CONFIG.DEFAULTS.SORT_DIR;

const JOB_ICON = { stitch:'🧵', cut_stitch:'✂️', cut_pack:'📦', fob:'🚢' };

function _avFilteredVendorStats(v) {
  const allLots = v.lots || [];

  const activeLots = allLots.filter(l => l.pending_qty > 0);

  return {
    batches:      activeLots.length,
    issue_qty:    allLots.reduce((s,l) => s + l.issue_qty, 0),
    pending_qty:  activeLots.reduce((s,l) => s + l.pending_qty, 0),
    received_qty: allLots.reduce((s,l) => s + (l.received_qty||0), 0),
  };
}

function _avBuildRows() {
  const rows = [];
  ['stitch','cut_stitch','cut_pack'].forEach(job => {
    (VENDOR_DB[job]||[]).forEach(v => {
      const filtered = _avFilteredVendorStats(v);
      const merged = { ...v, ...filtered, job, jobLabel: JOB_LABELS[job] };
      merged.score = scoreVendor(merged);
      rows.push(merged);
    });
  });
  return rows;
}

function avFilter(job) {
  _avJob = job;
  document.querySelectorAll('.av-tab').forEach(t => {
    t.classList.toggle('av-tab-active', t.dataset.job === job);
  });
  avRender();
}

function avSort(col) {
  if (_avSortCol === col) {
    _avSortDir = _avSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    _avSortCol = col;
    _avSortDir = col === 'name' ? 'asc' : 'desc';
  }
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === col) th.classList.add(_avSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
  const labels = { name:'Name', batches:'Batches', avgDays:'Avg Days', debit:'Debit %',
                   alter:'Alter %', cap:'Can Make' };
  document.getElementById('av-sort-info').textContent =
    `Sorted by ${labels[col]||col} ${_avSortDir==='asc'?'↑':'↓'}`;
  avRender();
}

// ── Can Make cell: design chips with active/registered classification ──
function _getVendorDesignClasses(v) {
  const allDesigns = v.designs || [];
  const activeLots = (v.lots || []).filter(l => l.pending_qty > 0);
  const activeDesignSet = new Set(activeLots.map(l => l.design));
  const active = allDesigns.filter(d => activeDesignSet.has(d));
  const registered = allDesigns.filter(d => !activeDesignSet.has(d));
  return { active, registered, total: allDesigns.length };
}

function _renderCanMakeCell(v) {
  const { active, registered, total } = _getVendorDesignClasses(v);
  const MAX_CHIPS = CONFIG.DEFAULTS.MAX_DESIGN_CHIPS;
  const showActive = active.slice(0, MAX_CHIPS);
  let remaining = MAX_CHIPS - showActive.length;
  const showReg = remaining > 0 ? registered.slice(0, remaining) : [];
  const overflow = total - showActive.length - showReg.length;

  let html = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">';
  showActive.forEach(d => {
    html += `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;font-family:'JetBrains Mono',monospace;background:var(--teal);color:#fff;white-space:nowrap"><span style="width:5px;height:5px;border-radius:50%;background:#fff;flex-shrink:0"></span>${d}</span>`;
  });
  showReg.forEach(d => {
    html += `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;font-family:'JetBrains Mono',monospace;background:var(--surface3);color:var(--text2);border:1px solid var(--border);white-space:nowrap">${d}</span>`;
  });
  if (overflow > 0) {
    html += `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:700;font-family:'JetBrains Mono',monospace;background:var(--surface3);color:var(--muted);border:1px solid var(--border)">+${overflow}</span>`;
  }
  html += '</div>';
  html += `<div style="font-size:9px;font-family:'JetBrains Mono',monospace;color:var(--muted)">${active.length} active · ${registered.length} registered</div>`;
  return html;
}

function avRender() {
  const all = _avBuildRows();
  const q = (document.getElementById('av-search')?.value || '').trim().toLowerCase();
  let rows = all.filter(v => {
    const jobOk = _avJob === 'all' || v.job === _avJob;
    const qOk   = !q || v.name.toLowerCase().includes(q) || v.jobLabel.toLowerCase().includes(q);
    return jobOk && qOk;
  });

  // sort
  rows.sort((a,b) => {
    let va = a[_avSortCol], vb = b[_avSortCol];
    if (typeof va === 'string') va = va.toLowerCase(), vb = vb.toLowerCase();
    if (va < vb) return _avSortDir==='asc' ? -1 : 1;
    if (va > vb) return _avSortDir==='asc' ? 1 : -1;
    return 0;
  });

  // Update tab counts
  const counts = { all: all.length };
  ['stitch','cut_stitch','cut_pack'].forEach(j => {
    counts[j] = all.filter(v => v.job === j).length;
  });
  ['all','stitch','cut_stitch','cut_pack'].forEach(j => {
    const el = document.getElementById('av-ct-'+j);
    if (el) el.textContent = counts[j];
  });
  document.getElementById('av-total-badge').textContent = rows.length + ' vendor' + (rows.length!==1?'s':'');

  // Summary strip
  document.getElementById('avs-stitch').textContent = counts.stitch;
  document.getElementById('avs-cut_stitch').textContent = counts.cut_stitch;
  document.getElementById('avs-cut_pack').textContent = counts.cut_pack;
  const totalCap = all.reduce((s,v) => s + (v.cap||0), 0);
  document.getElementById('avs-cap').textContent = totalCap.toLocaleString('en-IN');

  // Render rows
  const tbody = document.getElementById('av-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="av-empty">No vendors match your filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((v, i) => {
    const rank = i + 1;
    const rnkCls = rank===1?'r1':rank===2?'r2':rank===3?'r3':'rx';
    const debitCls = v.debit > CONFIG.THRESHOLDS.DEBIT.DANGER ? 'p-danger' : v.debit > CONFIG.THRESHOLDS.DEBIT.WARN ? 'p-warn' : 'p-ok';
    const alterCls = v.alter > CONFIG.THRESHOLDS.ALTER.DANGER ? 'p-danger' : v.alter > CONFIG.THRESHOLDS.ALTER.WARN ? 'p-warn' : 'p-ok';
    const daysCls  = v.avgDays <= CONFIG.THRESHOLDS.DAYS.OK ? 'p-ok' : v.avgDays <= CONFIG.THRESHOLDS.DAYS.WARN ? 'p-warn' : 'p-danger';
    const jtCls = 'jt-' + v.job;
    const trend = v.avgDays <= CONFIG.THRESHOLDS.TREND.FAST ? '<span class="trend-pill tp-fast">▲ Fast</span>' :
                  v.avgDays >= CONFIG.THRESHOLDS.TREND.SLOW  ? '<span class="trend-pill tp-slow">▼ Slow</span>' :
                  '<span class="trend-pill tp-stbl">~ Stable</span>';

    const debitAmt    = v.debit_amount || 0;
    const debitAmtStr = debitAmt >= 1e5 ? '₹'+(debitAmt/1e5).toFixed(2)+'L' : '₹'+Math.round(debitAmt).toLocaleString('en-IN');
    const dnCount     = v.debit_count || 0;
    const lastDnDate  = v.last_debit_date ? new Date(v.last_debit_date) : null;
    const dnDateStr   = lastDnDate ? lastDnDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    const dnDaysAgo   = lastDnDate ? Math.round((new Date() - lastDnDate) / 86400000) : 0;

    return `<tr class="${rank===1?'row-hl':''}">
      <td><span class="rnk ${rnkCls}">${rank}</span></td>
      <td>
        <div class="vname">${v.name}</div>
        <div class="vsub">${v.city} · Cap: ${v.cap.toLocaleString('en-IN')}/mo</div>
      </td>
      <td><span class="card-tag ${jtCls}">${JOB_ICON[v.job]} ${v.jobLabel}</span></td>
      <td>
        <span class="click-cell" onclick="openBatchModal('${v.name}','${v.job}','${v.jobLabel}',event)">
          ${v.batches} active lots
        </span>
        <div style="font-size:11px;font-weight:800;color:var(--warn);font-family:'JetBrains Mono',monospace;margin-top:2px">${(v.pending_qty||0).toLocaleString('en-IN')} pcs</div>
        <div class="vsub">pending</div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="opill ${daysCls}">${v.avgDays}d</span>${trend}
        </div>
      </td>
      <td>
        <div style="font-size:12px;font-weight:800;color:${v.debit > CONFIG.THRESHOLDS.DEBIT.DANGER ? 'var(--danger)' : v.debit > CONFIG.THRESHOLDS.DEBIT.WARN ? 'var(--warn)' : 'var(--green)'};font-family:'JetBrains Mono',monospace;letter-spacing:-.3px">${v.debit.toFixed(2)}%</div>
        <div class="vsub" style="margin-top:2px">${debitAmtStr} · ${dnCount} DN</div>
        <div class="vsub">${dnDateStr} · ${dnDaysAgo}d ago</div>
      </td>
      <td><span class="opill ${alterCls}">${v.alter.toFixed(1)}%</span></td>
      <td style="white-space:normal;max-width:220px;cursor:pointer" onclick="openCapModal('${v.name}','${v.job}','${v.jobLabel}',${rank},event)">
        ${_renderCanMakeCell(v)}
      </td>
    </tr>`;
  }).join('');
}

// init set default sort arrow
document.addEventListener('DOMContentLoaded', () => {
  const batchesHeader = document.querySelector('th[data-col="batches"]');
  if (batchesHeader) batchesHeader.classList.add('sort-desc');
  loadData();
});

// Set date
document.getElementById('date-badge').textContent = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});

function selectJobType(type) {
  selectedJob = type;
  document.querySelectorAll('.job-card').forEach(c => c.classList.remove('active'));
  document.getElementById('jc-'+type).classList.add('active');
  document.getElementById('config-panel').classList.remove('hidden');
  document.getElementById('results-wrap').classList.add('hidden');
  document.getElementById('config-panel').scrollIntoView({behavior:'smooth', block:'start'});
}

function scoreVendor(v) {
  const total = v.issue_qty || 1;
  const completion = (v.received_qty || 0) / total;
  const pendingRatio = (v.pending_qty || 0) / total;
  return (completion   * CONFIG.SCORING.COMPLETION_WEIGHT)
       + (v.batches    * CONFIG.SCORING.BATCH_WEIGHT)
       - (pendingRatio * CONFIG.SCORING.PENDING_PENALTY)
       + ((5 - v.debit) * CONFIG.SCORING.DEBIT_FACTOR)
       + ((5 - v.alter) * CONFIG.SCORING.ALTER_FACTOR);
}

// ── ASYNC runAnalysis: POSTs to backend ──
async function runAnalysis() {
  const design = _selectedDesign;
  const subcat = Array.from(_selectedSections).join(', ') || 'All Sections';
  const qty    = parseInt(document.getElementById('inp-qty').value);
  const days   = parseInt(document.getElementById('inp-days').value);
  if (!design || _selectedSections.size === 0 || !qty || !days) {
    alert('Please select a design, at least one section, quantity, and delivery days.');
    return;
  }

  let data;
  try {
    const res = await fetch(CONFIG.API_BASE_URL + CONFIG.API_ROUTES.ANALYZE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        design,
        sections: Array.from(_selectedSections),
        qty,
        days,
        jobType: selectedJob
      })
    });
    if (!res.ok) {
      const err = await res.json();
      alert('Analysis error: ' + (err.error || res.statusText));
      return;
    }
    data = await res.json();
  } catch (err) {
    alert(`Could not reach backend. Is the server running on port ${CONFIG.API_BASE_URL}?`);
    return;
  }

  const { split, bestDays, saved, totalCap, jobLabel, designMatch } = data;

  // KPI
  const accentColors = ['var(--teal)', 'var(--accent)', 'var(--green)', 'var(--warn)', 'var(--danger)'];
  const kpis = [
    { icon:'📦', cls:'ki-teal', label:'Total Pieces', val:qty.toLocaleString('en-IN'), sub: subcat+' · '+design, color:accentColors[0] },
    { icon:'⚡', cls:'ki-green', label:'Est. Completion', val:bestDays+'d', sub:'with load split', color:accentColors[2] },
    { icon:'🏭', cls:'ki-blue', label:'Vendors Assigned', val:split.length, sub:'top-ranked active', color:accentColors[1] },
    { icon:'📉', cls:'ki-warn', label:'Days Saved', val:'+'+saved+'d', sub:'vs single vendor', color:saved>0?accentColors[2]:accentColors[3] },
    { icon:'🎯', cls:'ki-red', label:'Capacity Pool', val:totalCap.toLocaleString('en-IN'), sub:'pieces across split', color:accentColors[1] },
  ];
  document.getElementById('kpi-row').innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="kpi-accent" style="background:${k.color}"></div>
      <div class="kpi-body">
        <div class="kpi-icon ${k.cls}">${k.icon}</div>
        <div class="kpi-content">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.val}</div>
          <div class="kpi-sub">${k.sub}</div>
        </div>
      </div>
      <div class="kpi-footer">
        <span class="kpi-status">
          <span class="kpi-status-dot" style="background:${k.color}"></span>
          ${jobLabel}
        </span>
      </div>
    </div>
  `).join('');

  // Split Panel
  const roleStyles = {
    primary:   { vc:'vc-primary',   fill:'var(--teal)',   role:'svcr-primary' },
    secondary: { vc:'vc-secondary', fill:'var(--accent)', role:'svcr-secondary' },
    support:   { vc:'vc-support',   fill:'var(--green)',  role:'svcr-support' },
  };
  const maxDays = Math.max(...split.map(v => v.estDays));

  const vendorCards = split.map(v => {
    const st          = roleStyles[v.role];
    const meetsTarget = v.estDays <= days;
    const activeBadge = v.isActive
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:9px;font-weight:800;font-family:'JetBrains Mono',monospace;background:var(--danger);color:#fff;letter-spacing:.4px;margin-bottom:4px">● ACTIVE</span>`
      : `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:9px;font-weight:800;font-family:'JetBrains Mono',monospace;background:var(--surface3);color:var(--muted);border:1px solid var(--border);letter-spacing:.4px;margin-bottom:4px">PREV. WORKED</span>`;
    const activeInfo = v.isActive
      ? `<div style="font-size:10px;color:var(--danger);font-weight:700;margin-top:3px">
           ${v.activeLots} active lot${v.activeLots!==1?'s':''} · ${(v.pendingQty||0).toLocaleString('en-IN')} pcs pending
         </div>`
      : `<div style="font-size:10px;color:var(--muted);margin-top:3px">${v.completedLots} completed batch${v.completedLots!==1?'es':''}</div>`;
    return `
      <div class="split-vc ${st.vc}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="split-vc-role ${st.role}">${v.roleLabel}</div>
          ${activeBadge}
        </div>
        <div class="split-vc-name">${v.name}</div>
        ${activeInfo}
        <div class="split-vc-qty" style="margin-top:6px">${v.allotQty.toLocaleString('en-IN')}</div>
        <div class="split-vc-qlbl">pcs · ${Math.round(v.pct*100)}% of total</div>
        <div class="split-vc-bar">
          <div class="split-vc-bar-fill" style="width:${Math.round(v.pct*100)}%;background:${st.fill}"></div>
        </div>
        <div class="split-vc-days">
          <div class="split-vc-d" style="color:${meetsTarget ? 'var(--green)' : st.fill}">${v.estDays}</div>
          <div class="split-vc-dlbl">days est.</div>
        </div>
        <div class="split-vc-stats">
          Avg delivery: ${v.avgDays}d&nbsp;&nbsp;Invoice: ${v.invoice}/pc<br>
          Debit: ${v.debit.toFixed(1)}%&nbsp;&nbsp;Alter: ${v.alter.toFixed(1)}%<br>
          <span style="font-size:10px;font-weight:700;color:${meetsTarget ? 'var(--green)' : 'var(--warn)'}">
            ${meetsTarget ? '✔ Within ' + days + 'd target' : '⚠ Est. ' + v.estDays + 'd > target ' + days + 'd'}
          </span>
        </div>
      </div>
    `;
  }).join('');

  const tlColors = ['var(--teal)', 'var(--accent)', 'var(--green)'];
  const tlRows = split.map((v,i) => `
    <div class="split-tl-row">
      <div class="split-tl-name">${v.name}</div>
      <div class="split-tl-track">
        <div class="split-tl-fill" style="width:${Math.round((v.estDays/maxDays)*95)}%;background:${tlColors[i]}">
          <div class="split-tl-fill-lbl">${v.allotQty.toLocaleString('en-IN')} pcs</div>
        </div>
      </div>
      <div class="split-tl-days" style="color:${tlColors[i]}">${v.estDays}d</div>
    </div>
  `).join('');

  document.getElementById('split-panel-wrap').innerHTML = `
    ${!designMatch ? `<div style="background:var(--warn-light,#fff8e1);border:1px solid var(--warn);border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:12px;color:var(--warn);font-weight:600">⚠️ No vendor found with prior experience on design <b>${design}</b> — showing best available vendors for this job type.</div>` : ''}
    <div class="split-hdr">
      <div class="split-hdr-left">
        <h4>⚡ Smart Load Split — ${jobLabel}</h4>
        <p>${qty.toLocaleString('en-IN')} pcs · ${subcat} · ${design} · ${split.length} vendor parallel track</p>
      </div>
      <div class="split-hdr-right">
        <div class="split-days">${bestDays}</div>
        <div class="split-days-lbl">DAYS TO COMPLETION</div>
      </div>
    </div>
    <div class="split-summary">
      <div class="split-stat">
        <div class="split-stat-val" style="color:var(--teal)">${bestDays}d</div>
        <div class="split-stat-lbl">Est. delivery (split)</div>
      </div>
      <div class="split-stat">
        <div class="split-stat-val" style="color:var(--green)">+${saved}d</div>
        <div class="split-stat-lbl">Days saved vs single</div>
      </div>
      <div class="split-stat">
        <div class="split-stat-val">${qty.toLocaleString('en-IN')}</div>
        <div class="split-stat-lbl">Total pieces</div>
      </div>
      <div class="split-stat">
        <div class="split-stat-val">${split.length}</div>
        <div class="split-stat-lbl">Active vendors</div>
      </div>
    </div>
    <div class="split-vendor-grid">${vendorCards}</div>
    <div class="split-timeline">
      <div class="split-tl-hdr">📅 DELIVERY TIMELINE — PARALLEL TRACKS</div>
      ${tlRows}
    </div>
  `;

  document.getElementById('results-wrap').classList.remove('hidden');
  setTimeout(()=>{
    document.getElementById('results-wrap').scrollIntoView({behavior:'smooth', block:'start'});
  }, 50);
}

// ── BATCH MODAL ──
function openBatchModal(vendorName, job, jobLabel, e) {
  if (e) e.stopPropagation();

  const vendor = (VENDOR_DB[job] || []).find(v => v.name === vendorName);
  const allLots = vendor?.lots || [];

  const activeLots = allLots.filter(l => l.pending_qty > 0);
  const totalPending = activeLots.reduce((s, l) => s + l.pending_qty, 0);
  const totalIssued  = activeLots.reduce((s, l) => s + l.issue_qty, 0);

  document.getElementById('batch-title').textContent = `Active Lots — ${vendorName}`;
  document.getElementById('batch-sub').textContent   = `${activeLots.length} lots with pending qty · ${totalPending.toLocaleString('en-IN')} pcs pending`;

  const today = new Date();
  const rows = activeLots.map(lot => {
    const issueDate = new Date(lot.date);
    const daysAgo = Math.round((today - issueDate) / 86400000);
    const ageCls = daysAgo > CONFIG.THRESHOLDS.LOT_AGE.DANGER ? 'lot-overdue' : daysAgo > CONFIG.THRESHOLDS.LOT_AGE.WARN ? 'lot-warn' : 'lot-ok';
    const dateStr = issueDate.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
    const received = lot.received_qty || 0;
    return `<tr>
      <td style="font-weight:800;color:var(--text)">${lot.lot_no}</td>
      <td>${lot.design}</td>
      <td>${lot.issue_qty.toLocaleString('en-IN')}</td>
      <td style="font-weight:700;color:var(--green)">${received.toLocaleString('en-IN')}</td>
      <td style="font-weight:700;color:var(--warn)">${lot.pending_qty.toLocaleString('en-IN')}</td>
      <td>${dateStr}</td>
      <td class="${ageCls}">${daysAgo}d</td>
    </tr>`;
  }).join('');

  document.getElementById('batch-body').innerHTML = `
    <div style="padding:10px 16px;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;gap:20px;flex-wrap:wrap;">
      <div style="text-align:center">
        <div style="font-size:18px;font-weight:800;color:var(--teal);line-height:1">${activeLots.length}</div>
        <div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px">ACTIVE LOTS</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:18px;font-weight:800;color:var(--warn);line-height:1">${totalPending.toLocaleString('en-IN')}</div>
        <div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px">TOTAL PENDING</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:18px;font-weight:800;color:var(--accent);line-height:1">${totalIssued.toLocaleString('en-IN')}</div>
        <div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px">TOTAL ISSUED</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:18px;font-weight:800;color:var(--green);line-height:1">${totalIssued > 0 ? Math.round(((totalIssued - totalPending) / totalIssued) * 100) : 0}%</div>
        <div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px">COMPLETION</div>
      </div>
    </div>
    <table class="jw-table">
      <thead><tr>
        <th>Lot No</th><th>Design</th><th>Issue Qty</th><th>Received Qty</th><th>Pending Qty</th><th>Issue Date</th><th>Age</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">No active lots with pending quantity.</td></tr>`}</tbody>
    </table>`;

  const overdue = activeLots.filter(l => Math.round((today - new Date(l.date)) / 86400000) > CONFIG.THRESHOLDS.LOT_AGE.WARN).length;
  document.getElementById('batch-footer').textContent =
    `${activeLots.length} active lots (pending > 0) · ${overdue} over 30 days · All pending lots shown regardless of issue date · Age colour: teal ≤30d · orange ≤60d · red >60d`;
  document.getElementById('batch-overlay').classList.add('open');
}

function closeBatchModal(e) {
  if (e && e.target !== document.getElementById('batch-overlay')) return;
  document.getElementById('batch-overlay').classList.remove('open');
}

// ── CAPACITY MODAL (rich tabbed) ──
const DESIGN_POOL = [
  '010-01','010-02','010-03','010-04','037-01','037-02','037-03','037-04',
  '038-01','038-02','038-03','038-04','041-04','045-01','045-02','045-03',
  '045-04','047-01','047-02','047-03','049-01','049-02','049-03','049-04',
  '052-01','052-02','052-03','052-04','053-01','053-02','053-03','053-04',
  '057-01','057-02','057-03','371-01','371-02','371-03','371-04','379-01',
  '379-02','379-03','379-04','382-01','382-02','382-04','550-01','550-02',
  '550-03','550-04','221-01','221-02','334-01','334-02','712-01','712-02',
  '815-03','815-04','610-01','610-02'
];

let _capAllDesigns = [];
let _capTab = 'active';

function openCapModal(vendorName, job, jobLabel, rank, e) {
  if (e) e.stopPropagation();

  const vendor = (VENDOR_DB[job] || []).find(v => v.name === vendorName);
  const realDesigns = vendor?.designs || [];
  const lots = vendor?.lots || [];

  const activeLots = lots.filter(l => l.pending_qty > 0);
  const activeDesignSet = new Set(activeLots.map(l => l.design));
  const pendingLotCount = activeLots.length;

  _capAllDesigns = realDesigns.map(d => ({
    no: d,
    status: activeDesignSet.has(d) ? 'active' : 'registered'
  }));

  const activeCount = _capAllDesigns.filter(d => d.status === 'active').length;
  const regCount    = _capAllDesigns.filter(d => d.status === 'registered').length;

  document.getElementById('cap-modal-title').textContent = vendorName.toUpperCase();
  document.getElementById('cap-modal-sub').textContent =
    `${pendingLotCount} pending lots · ${realDesigns.length} designs`;
  document.getElementById('cap-rank-num').textContent = `#${rank}`;

  const totalEl = document.getElementById('cap-cnt-total');
  if (totalEl) totalEl.textContent = realDesigns.length;

  _capTab = 'all';
  _capRenderTabs();
  _capRenderChips('');
  document.getElementById('cap-search-input').value = '';
  document.getElementById('cap-overlay').classList.add('open');
}

function _capRenderTabs() {
  document.querySelectorAll('.cap-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === _capTab);
  });
}

function _capRenderChips(query) {
  const filtered = _capAllDesigns.filter(d => {
    const matchQ   = !query || d.no.toUpperCase().includes(query.toUpperCase());
    const matchTab = _capTab === 'all' || d.status === _capTab;
    return matchQ && matchTab;
  });

  const active = filtered.filter(d => d.status === 'active');
  const reg    = filtered.filter(d => d.status === 'registered');
  const totalActive = _capAllDesigns.filter(d => d.status === 'active').length;
  const totalReg    = _capAllDesigns.filter(d => d.status === 'registered').length;

  document.getElementById('cap-stats-txt').innerHTML =
    `${_capAllDesigns.length} total &nbsp;·&nbsp; <span style="color:var(--teal)">${totalActive} active</span> &nbsp;·&nbsp; <span style="color:var(--accent)">${totalReg} registered</span>`;

  const wrap = document.getElementById('cap-chips');
  if (!filtered.length) {
    wrap.innerHTML = `<div class="cap-empty">No designs match your search.</div>`;
    return;
  }

  let html = '';
  active.forEach(d => {
    html += `<div class="cap-chip" style="border-color:var(--teal);background:var(--teal-light)">
      ${d.no}
      <span class="cap-chip-badge cb-active">▶ Active</span>
    </div>`;
  });
  reg.forEach(d => {
    html += `<div class="cap-chip">
      ${d.no}
      <span class="cap-chip-badge cb-reg">★ Registered</span>
    </div>`;
  });
  wrap.innerHTML = html;
}

function capSwitchTab(tab) {
  _capTab = tab;
  _capRenderTabs();
  _capRenderChips((document.getElementById('cap-search-input')?.value || '').trim());
}

function capSearch(val) {
  _capRenderChips(val.trim());
}

function closeCapModal(e) {
  if (e && e.target !== document.getElementById('cap-overlay')) return;
  document.getElementById('cap-overlay').classList.remove('open');
}
