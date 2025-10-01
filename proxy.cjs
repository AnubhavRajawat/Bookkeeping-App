// proxy.cjs
// CommonJS Express proxy that handles CORS preflight properly and forwards requests.
// Usage: TARGET_URL="https://your-target.example" PORT=10000 node proxy.cjs

const express = require('express');
const bodyParser = require('body-parser');

let fetchImpl;
try {
  // Node 18+ has global fetch
  fetchImpl = globalThis.fetch;
  if (!fetchImpl) {
    fetchImpl = require('node-fetch'); // ensure node-fetch@2 is installed for Node < 18
  }
} catch (e) {
  fetchImpl = require('node-fetch');
}

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

const TARGET_URL = process.env.TARGET_URL || '';
const PORT = process.env.PORT || 3000;

if (!TARGET_URL) {
  console.error('ERROR: TARGET_URL not set. Set env var TARGET_URL to your Google Apps Script URL.');
}

const allowedOrigins = new Set([
  'https://bookkeeping-app-zeta.vercel.app',
  // optionally add other explicit frontends:
  // 'https://bookkeeping-1znkkjkoy-anubhavrajawats-projects.vercel.app',
  'http://localhost:5173'
]);

function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith('.vercel.app')) return true; // allow vercel preview subdomains
  } catch (e) {}
  return false;
}

// Simple request logger for Render logs
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} -> ${req.method} ${req.originalUrl} Origin:${req.get('Origin') || '-'}`);
  next();
});

// CORS middleware + preflight handling
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-upload-secret');
    res.setHeader('Access-Control-Max-Age', '600'); // cache preflight
  }

  if (req.method === 'OPTIONS') {
    if (origin && originAllowed(origin)) return res.sendStatus(204);
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }
  next();
});

// Health route — quick check that the proxy started
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`Proxy alive. Proxying to ${TARGET_URL || '(no TARGET_URL set)'}`);
});

// GET /api/csv-data -> proxy GET (target must accept GET)
app.get('/api/csv-data', async (req, res) => {
  const origin = req.get('Origin');
  if (!origin || !originAllowed(origin)) return res.status(403).json({ error: 'Origin not allowed' });

  try {
    const url = `${TARGET_URL.replace(/\/$/, '')}/csv-data`; // adjust target path if necessary
    console.log(`Proxying GET to ${url}`);
    const fetchRes = await fetchImpl(url, { method: 'GET' });
    const text = await fetchRes.text();
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(fetchRes.status).send(text);
  } catch (err) {
    console.error('Error proxying GET /api/csv-data:', err);
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(502).json({ error: 'Bad gateway', details: err.message });
  }
});

// POST /api/bookkeeping -> proxy POST
app.post('/api/bookkeeping', async (req, res) => {
  const origin = req.get('Origin');
  if (!origin || !originAllowed(origin)) return res.status(403).json({ error: 'Origin not allowed' });

  if (!TARGET_URL) {
    return res.status(500).json({ error: 'TARGET_URL not configured on server' });
  }

  try {
    const url = TARGET_URL; // full URL of the Apps Script doPost
    console.log(`Proxying POST to ${url} bodyKeys:${Object.keys(req.body).length}`);
    const forwardHeaders = {
      'Content-Type': req.get('Content-Type') || 'application/json',
    };

    const fetchRes = await fetchImpl(url, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(req.body),
    });

    const text = await fetchRes.text();

    // Log status and (truncated) body for debugging
    console.log(`Upstream status: ${fetchRes.status}`);
    if (text && text.length > 1000) {
      console.log('Upstream body (truncated):', text.slice(0, 1000));
    } else {
      console.log('Upstream body:', text);
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(fetchRes.status).send(text);
  } catch (err) {
    console.error('Proxy POST error:', err && err.stack ? err.stack : err);
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(502).json({ error: 'Bad gateway', details: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}. TARGET_URL=${TARGET_URL}`);
});
