const CONFIG = {
  // ── Backend API ──
  API_BASE_URL: '',
  API_ROUTES: {
    VENDORS: '/api/vendors',
    DESIGNS: '/api/designs',
    ANALYZE: '/api/analyze',
    STATUS:  '/api/status',
    REFRESH: '/api/refresh',
  },

  // ── App Identity ──
  APP_TITLE:    'Production Planning & Control (PPC)',
  APP_SUBTITLE: 'THIRD-PARTY VENDOR MANAGEMENT · LOAD SPLIT · DELIVERY OPTIMISATION',

  // ── Vendor Table Defaults ──
  DEFAULTS: {
    SORT_COL:           'batches',
    SORT_DIR:           'desc',
    MAX_DROPDOWN_ITEMS: 80,
    MAX_DESIGN_CHIPS:   4,
  },

  // ── Vendor Scoring Weights (must match backend/config.js SCORING) ──
  SCORING: {
    COMPLETION_WEIGHT: 60,
    BATCH_WEIGHT:      0.5,
    PENDING_PENALTY:   20,
    DEBIT_FACTOR:      5,
    ALTER_FACTOR:      4,
  },

  // ── Thresholds for colour-coded status pills ──
  THRESHOLDS: {
    DEBIT: { WARN: 1.5, DANGER: 2.5 },
    ALTER: { WARN: 2.0, DANGER: 3.0 },
    DAYS:  { OK: 14,    WARN: 20    },
    TREND: { FAST: 13,  SLOW: 20   },
    LOT_AGE: { WARN: 30, DANGER: 60 },
  },
};
