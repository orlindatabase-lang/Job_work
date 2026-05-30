const express    = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const dotenv     = require('dotenv');

dotenv.config();

const PORT       = process.env.PORT       || 4000;
const PROXY_KEY  = process.env.PROXY_KEY  || 'change-this-secret-key';
const ERP_TARGET = process.env.ERP_TARGET || 'http://190.92.175.131:8080';

const app = express();

// ── Auth middleware ───────────────────────────────────────────────────────────
// ── Health check (before auth so GCP can probe it) ───────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', target: ERP_TARGET });
});

// ── Auth middleware for all other routes ─────────────────────────────────────
app.use((req, res, next) => {
  const key = req.headers['x-proxy-key'];
  if (key !== PROXY_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Proxy all other requests to the ERP ──────────────────────────────────────
app.use('/', createProxyMiddleware({
  target:       ERP_TARGET,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq) => {
      // Strip the proxy auth header before forwarding to ERP
      proxyReq.removeHeader('x-proxy-key');
    },
    error: (err, req, res) => {
      console.error('Proxy error:', err.message);
      res.status(502).json({ error: 'ERP unreachable', detail: err.message });
    },
  },
}));

app.listen(PORT, () => {
  console.log(`ERP Proxy running on http://localhost:${PORT}`);
  console.log(`Forwarding to: ${ERP_TARGET}`);
  console.log(`Secured with PROXY_KEY: ${PROXY_KEY.slice(0, 4)}****`);
});
