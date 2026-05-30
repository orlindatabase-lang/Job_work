const express        = require('express');
const cors           = require('cors');
const path           = require('path');
const fs             = require('fs');
const { execSync }   = require('child_process');

const { PORT, CORS_ORIGIN, FRONTEND_DIR, API_ROUTES, JOB_LABELS, REFRESH_INTERVAL_MS,
        ERP_BASE_URL, API_TOKEN, COMPANY_YEAR_ID, PROXY_KEY } = require('./config');
const { loadFromCache } = require('./data');
const { rankVendors, rankVendorsForSplit, splitLoad } = require('./analysis');

const CACHE_PATH   = path.resolve(__dirname, 'cache.json');
const DATA_PY_PATH = path.resolve(__dirname, '../../data.py');
const PYTHON_PATH  = process.env.PYTHON_PATH
  || (process.platform === 'win32'
      ? path.resolve(__dirname, '../../venv/Scripts/python.exe')
      : 'python3');

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, FRONTEND_DIR)));

// Single state object — replaced atomically on each refresh
let _state = {
  VENDOR_DB:       { stitch: [], cut_stitch: [], cut_pack: [] },
  DESIGN_SECTIONS: {},
  lastRefreshed:   null,
  totalVendors:    0,
  totalDesigns:    0,
};

let _refreshing  = false;
let _lastError   = null;
let _nextRefresh = null;

// Runs data.py → writes cache.json → loads state from cache.
// On failure keeps the previous _state so the dashboard stays up.
async function fetchAndRefresh() {
  if (_refreshing) return;
  _refreshing = true;
  _lastError  = null;

  // Step 1: run data.py to fetch from ERP and write cache.json
  try {
    console.log('🐍 Running data.py...');
    execSync(`"${PYTHON_PATH}" "${DATA_PY_PATH}"`, {
      stdio: 'inherit',
      cwd:   path.resolve(__dirname, '../..'),
      env:   {
        ...process.env,
        ERP_BASE_URL,
        API_TOKEN,
        COMPANY_YEAR_ID,
        PROXY_KEY: PROXY_KEY || '',
      },
    });
    console.log('✅ data.py done — cache.json updated.');
  } catch (err) {
    _lastError  = `data.py failed: ${err.message}`;
    _refreshing = false;
    console.error('❌', _lastError);
    // Fall through to load last good cache if no state yet
    if (_state.lastRefreshed) return;
  }

  // Step 2: load state from cache.json (whether just written or from last run)
  try {
    if (!fs.existsSync(CACHE_PATH)) throw new Error('cache.json not found');
    const data = loadFromCache();
    _state = {
      VENDOR_DB:       data.VENDOR_DB,
      DESIGN_SECTIONS: data.DESIGN_SECTIONS,
      lastRefreshed:   new Date().toISOString(),
      totalVendors:    Object.values(data.VENDOR_DB).flat().length,
      totalDesigns:    Object.keys(data.DESIGN_SECTIONS).length,
    };
    console.log(`✅ State loaded — ${_state.totalVendors} vendors, ${_state.totalDesigns} designs`);
  } catch (err) {
    _lastError = _lastError || err.message;
    console.error('❌ Cache load failed:', err.message);
  } finally {
    _refreshing = false;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get(API_ROUTES.VENDORS, (req, res) => res.json(_state.VENDOR_DB));
app.get(API_ROUTES.DESIGNS, (req, res) => res.json(_state.DESIGN_SECTIONS));

app.get('/api/status', (req, res) => {
  res.json({
    status:        'ok',
    lastRefreshed: _state.lastRefreshed,
    nextRefresh:   _nextRefresh,
    totalVendors:  _state.totalVendors,
    totalDesigns:  _state.totalDesigns,
    refreshing:    _refreshing,
    lastError:     _lastError,
  });
});

app.post('/api/refresh', async (req, res) => {
  if (_refreshing) {
    return res.status(202).json({ status: 'in_progress', message: 'Refresh already running' });
  }
  console.log('🔄 Manual refresh triggered...');
  await fetchAndRefresh();
  if (_lastError) {
    return res.status(500).json({ status: 'error', error: _lastError });
  }
  res.json({
    status:        'ok',
    lastRefreshed: _state.lastRefreshed,
    totalVendors:  _state.totalVendors,
    totalDesigns:  _state.totalDesigns,
  });
});

app.post(API_ROUTES.ANALYZE, (req, res) => {
  const { design, sections, qty, days, jobType } = req.body;

  if (!design || !sections || !qty || !days || !jobType) {
    return res.status(400).json({ error: 'Missing required fields: design, sections, qty, days, jobType' });
  }

  const vendorList = _state.VENDOR_DB[jobType];
  if (!vendorList || vendorList.length === 0) {
    return res.status(400).json({ error: `No vendors found for job type: ${jobType}` });
  }

  const { ranked, designMatch } = rankVendorsForSplit(vendorList, design, days);

  if (!ranked.length) {
    return res.status(400).json({ error: 'No vendors available for this job type.' });
  }

  const split    = splitLoad(ranked, qty, days);
  const bestDays = split.length ? Math.max(...split.map(v => v.estDays)) : 0;

  // "Days saved" vs giving all qty to the single fastest vendor
  const top1             = ranked[0];
  const dailyCap1        = (top1.cap || 1000) / 30;
  const singleVendorDays = Math.max(top1.avgDays, Math.ceil(qty / dailyCap1));
  const saved            = Math.max(0, singleVendorDays - bestDays);

  const totalCap = split.reduce((s, v) => s + v.cap, 0);
  const jobLabel = JOB_LABELS[jobType] || jobType;
  const subcat   = Array.isArray(sections) ? sections.join(', ') : sections;

  res.json({ split, bestDays, saved, totalCap, jobLabel, subcat, qty, design, designMatch });
});

// ── Startup ───────────────────────────────────────────────────────────────────

fetchAndRefresh()
  .then(() => {
    if (!_state.lastRefreshed) {
      console.error('❌ Failed to load data on startup.');
      process.exit(1);
    }

    app.listen(PORT, () => {
      console.log(`PPC Dashboard running on http://localhost:${PORT}`);
      console.log(`   Vendors: ${_state.totalVendors}  |  Designs: ${_state.totalDesigns}`);
      console.log(`   Auto-refresh every ${REFRESH_INTERVAL_MS / 60000} minutes`);
    });

    // Schedule auto-refresh
    setInterval(() => {
      _nextRefresh = null;
      fetchAndRefresh().then(() => {
        _nextRefresh = new Date(Date.now() + REFRESH_INTERVAL_MS).toISOString();
      });
    }, REFRESH_INTERVAL_MS);

    _nextRefresh = new Date(Date.now() + REFRESH_INTERVAL_MS).toISOString();
  });
