// proxy.cjs
// CommonJS Express proxy that handles CORS preflight and forwards requests.
// Usage example:
//   TARGET_URL="https://script.google.com/macros/s/xxxxx/exec" PORT=3000 node proxy.cjs
// If you deploy to Render/Vercel make sure TARGET_URL is set in that platform's env vars.

const express = require('express');
const fetch = require('node-fetch'); // node-fetch@2 recommended for CommonJS (or use global fetch in Node >=18)
const bodyParser = require('body-parser');
const querystring = require('querystring');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const TARGET_URL = (process.env.TARGET_URL || 'https://your-google-apps-script-url.example').replace(/\/$/, '');
const PORT = process.env.PORT || 3000;

// Allowed origins: add your production & preview Vercel hosts here
const allowedOrigins = new Set([
  'https://bookkeeping-app-zeta.vercel.app',    // main frontend
  'https://bookkeeping-1znkkjkoy-anubhavrajawats-projects.vercel.app', // example preview (add real ones you use)
  'http://localhost:5173',                      // local dev
  // add other explicit origins you need
]);

function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    // allow any Vercel preview subdomain if you trust it
    if (url.hostname.endsWith('.vercel.app')) return true;
  } catch (e) { /* invalid origin */ }
  return false;
}

// CORS middleware
app.use((req, res, next) => {
  const origin = req.get('Origin');

  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    // Uncomment if you use cookies/credentials:
    // res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-upload-secret');
    res.setHeader('Access-Control-Max-Age', '600'); // cache preflight for 10 minutes
  }

  if (req.method === 'OPTIONS') {
    if (origin && originAllowed(origin)) {
      return res.sendStatus(204);
    } else {
      return res.status(403).json({ error: 'CORS origin not allowed' });
    }
  }

  next();
});

// Generic proxy for all /api/* routes
app.all('/api/*', async (req, res) => {
  const origin = req.get('Origin');
  if (!origin || !originAllowed(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  // Build target URL: strip /api prefix and append path/query to TARGET_URL
  const forwardPath = req.path.replace(/^\/api/, '') || '/';
  const forwardUrl = TARGET_URL + forwardPath + (Object.keys(req.query).length ? `?${querystring.stringify(req.query)}` : '');

  try {
    // Build forward headers (copy content-type; you can copy auth header if needed)
    const forwardHeaders = {
      'Accept': req.get('Accept') || '*/*',
    };

    if (req.get('Content-Type')) forwardHeaders['Content-Type'] = req.get('Content-Type');

    // If your target expects form data (x-www-form-urlencoded) handle that
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if ((req.get('Content-Type') || '').includes('application/json')) {
        body = JSON.stringify(req.body || {});
      } else if ((req.get('Content-Type') || '').includes('application/x-www-form-urlencoded')) {
        body = querystring.stringify(req.body || {});
      } else {
        // For other content types (text/plain etc.) try to forward raw body via req.body (express bodyParser may have parsed it)
        body = req.rawBody || JSON.stringify(req.body || {});
      }
    }

    console.log(`[proxy] ${req.method} ${req.originalUrl} -> ${forwardUrl}`);

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      // only include body for methods that allow it
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    };

    const targetRes = await fetch(forwardUrl, fetchOptions);

    const text = await targetRes.text();

    // Mirror CORS on the proxied response too
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(targetRes.status);

    // Forward content-type from target if present
    const ct = targetRes.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    return res.send(text);
  } catch (err) {
    console.error('[proxy] error forwarding to target:', err);
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    return res.status(502).json({ error: 'Bad gateway', details: err.message });
  }
});

app.get('/', (req, res) => res.send(`Proxy running. Forwarding /api/* to: ${TARGET_URL}`));

app.listen(PORT, () => console.log(`Proxy listening on port ${PORT}, forwarding /api/* -> ${TARGET_URL}`));
