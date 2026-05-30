module.exports = {
  PORT: parseInt(process.env.PORT) || 3001,
  CORS_ORIGIN: '*',
  FRONTEND_DIR: '../frontend',

  // How often to auto-fetch fresh ERP data (ms). Default: 30 minutes.
  REFRESH_INTERVAL_MS: 30 * 60 * 1000,

  // ERP API — on GCP set ERP_BASE_URL to the proxy URL, locally it hits ERP directly
  ERP_BASE_URL:    process.env.ERP_BASE_URL    || 'http://190.92.175.131:8080/DigiBizzErpApi/api/UnknownCallerApi/GetPowerBiReports',
  API_TOKEN:       process.env.API_TOKEN       || 'aaaqqqwww111',
  COMPANY_YEAR_ID: process.env.COMPANY_YEAR_ID || '83',
  PROXY_KEY:       process.env.PROXY_KEY       || '',

  API_ROUTES: {
    VENDORS: '/api/vendors',
    DESIGNS: '/api/designs',
    ANALYZE: '/api/analyze',
  },

  JOB_LABELS: {
    stitch:     'Only Stitch',
    cut_stitch: 'Cut to Stitch',
    cut_pack:   'Cut to Pack',
    fob:        'FoB',
  },

  SCORING: {
    COMPLETION_WEIGHT: 60,
    BATCH_WEIGHT:      0.5,
    PENDING_PENALTY:   20,
    DEBIT_FACTOR:      5,
    ALTER_FACTOR:      4,
  },
};
