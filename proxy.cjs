// proxy.cjs
// CommonJS Express proxy that handles CORS preflight properly and forwards requests.
// Usage: NODE_ENV=production TARGET_URL="https://script.google.com/..." node proxy.cjs
const express = require('express');
const fetch = require('node-fetch'); // install node-fetch@2 if using node < 18
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

const TARGET_URL = process.env.TARGET_URL || 'https://your-google-apps-script-url.example';
const PORT = process.env.PORT || 3000;

// Allowed origins: add your production & preview Vercel hosts here
const allowedOrigins = new Set([
  'https://bookkeeping-app-zeta.vercel.app',    // your main frontend
  'https://bookkeeping-app-rmvi.onrender.com', // (if frontend served here in some case)
  'http://localhost:5173',                      // local dev
  // add any explicit preview URLs you use, e.g.:
  // 'https://bookkeeping-1znkkjkoy-anubhavrajawats-projects.vercel.app'
]);

// Alternatively allow any vercel.app preview origins via pattern:
function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  // allow *.vercel.app (preview deployments) — only if you trust all vercel.app subdomains
  try {
    const url = new URL(origin);
    if (url.hostname.endsWith('.vercel.app')) return true;
  } catch (e) { /* not a valid origin */ }
  return false;
}

// CORS middleware
app.use((req, res, next) => {
  const origin = req.get('Origin');

  if (origin && originAllowed(origin)) {
    // Mirror the incoming Origin — required for credentialed requests and security
    res.setHeader('Access-Control-Allow-Origin', origin);
    // Allow credentials if needed: res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-upload-secret');
    // Cache preflight for a short time:
    res.setHeader('Access-Control-Max-Age', '600'); // 10 minutes
  }

  // OPTIONS preflight: respond immediately if origin is allowed
  if (req.method === 'OPTIONS') {
    if (origin && originAllowed(origin)) {
      return res.sendStatus(204); // No Content
    } else {
      // If origin not allowed, explicitly reject with 403 so it's obvious in logs (browser will still block).
      return res.status(403).json({ error: 'CORS origin not allowed' });
    }
  }

  next();
});

// Example POST proxy endpoint
app.post('/api/bookkeeping', async (req, res) => {
  const origin = req.get('Origin');
  if (!origin || !originAllowed(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  try {
    // Forward headers you want (you can drop Authorization if not needed)
    const forwardHeaders = {
      'Content-Type': req.get('Content-Type') || 'application/json',
      // copy any other headers needed by target, such as Authorization:
      // 'Authorization': req.get('Authorization') || '',
    };

    // If your target expects URL-encoded form rather than JSON, adjust accordingly.
    const fetchResponse = await fetch(TARGET_URL, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(req.body),
      // credentials: 'include' // not relevant server-to-server
    });

    const text = await fetchResponse.text();
    // Pass through status and body
    // Ensure we re-set CORS header on the actual response too (already done in middleware, but double-check)
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(fetchResponse.status).send(text);
  } catch (err) {
    console.error('Proxy error:', err);
    // Ensure CORS header present on error responses too (so browser can see the message during dev)
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(502).json({ error: 'Bad gateway', details: err.message });
  }
});

app.get('/', (req, res) => res.send('Proxy alive'));

app.listen(PORT, () => console.log(`Proxy listening on port ${PORT}, proxying to ${TARGET_URL}`));
