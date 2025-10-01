// proxy.cjs
// CommonJS Express proxy that handles CORS preflight properly and forwards requests.
// Usage: TARGET_URL="https://script.google.com/..." [CSV_URL="..."] PORT=10000 node proxy.cjs

const express = require('express');
const fetch = require('node-fetch'); // node-fetch@2
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

const TARGET_URL = process.env.TARGET_URL || ''; // e.g. https://script.google.com/macros/s/XXX/exec
const CSV_URL = process.env.CSV_URL || ''; // optional full URL for CSV if different
const PORT = process.env.PORT || 10000;

if (!TARGET_URL) {
  console.warn('ERROR: TARGET_URL not set. Set env var TARGET_URL to your Apps Script URL.');
}

// Allowed origins
const allowedOrigins = new Set([
  'https://bookkeeping-app-zeta.vercel.app',
  'http://localhost:5173',
  // add any other exact allowed origins
]);

function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname.endsWith('.vercel.app')) return true; // allow preview Vercel subdomains
  } catch (e) {}
  return false;
}

app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-upload-secret');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    if (origin && originAllowed(origin)) return res.sendStatus(204);
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }

  next();
});

// Health
app.get('/', (req, res) => {
  res.send(`Proxy alive. Proxying to ${TARGET_URL || '(no TARGET_URL set)'}${CSV_URL ? `, CSV_URL=${CSV_URL}` : ''}`);
});

// POST -> forward to TARGET_URL for sheets submission
app.post('/api/bookkeeping', async (req, res) => {
  const origin = req.get('Origin');
  if (!origin || !originAllowed(origin)) return res.status(403).json({ error: 'Origin not allowed' });

  if (!TARGET_URL) return res.status(500).json({ error: 'TARGET_URL not configured on server' });

  try {
    const forwardHeaders = {
      'Content-Type': req.get('Content-Type') || 'application/json',
    };

    const upstream = await fetch(TARGET_URL, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(req.body),
    });

    const text = await upstream.text();
    // mirror upstream content-type if present
    const upstreamType = upstream.headers.get('content-type');
    if (upstreamType) res.setHeader('Content-Type', upstreamType);

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(upstream.status || 200).send(text);
  } catch (err) {
    console.error('Proxy POST error:', err);
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(502).json({ error: 'Bad gateway', details: err.message });
  }
});

// GET /api/csv-data -> forward to CSV_URL or TARGET_URL + path
app.get('/api/csv-data', async (req, res) => {
  const origin = req.get('Origin');
  if (!origin || !originAllowed(origin)) return res.status(403).json({ error: 'Origin not allowed' });

  // choose URL to fetch CSV from
  const targetCsv = CSV_URL || (TARGET_URL ? (TARGET_URL + (TARGET_URL.endsWith('/') ? '' : '/') + 'csv') : '');

  if (!targetCsv) return res.status(500).json({ error: 'CSV URL not configured (CSV_URL or TARGET_URL required)' });

  try {
    const upstream = await fetch(targetCsv, { method: 'GET' });
    const buffer = await upstream.buffer(); // binary-safe
    const upstreamType = upstream.headers.get('content-type') || 'text/plain';

    // send same content-type so frontend can parse CSV/text/HTML as needed
    res.setHeader('Content-Type', upstreamType);
    res.setHeader('Access-Control-Allow-Origin', origin);

    res.status(upstream.status || 200).send(buffer);
  } catch (err) {
    console.error('Proxy GET csv error:', err);
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(502).json({ error: 'Bad gateway', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}, proxying to ${TARGET_URL}`);
});
