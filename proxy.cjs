// proxy.cjs
// Express proxy + CSV upload + CSV serve + forward to Apps Script
const express = require('express');
const fetch = require('node-fetch'); // v2
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Config from env
const PORT = process.env.PORT || 10000;
const TARGET_URL = process.env.TARGET_URL || process.env.APPS_SCRIPT_URL || ''; // prefer TARGET_URL, fallback to APPS_SCRIPT_URL
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || process.env.UPLOAD_SECRET_KEY || 'super-secret';
const allowedOriginsList = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

// ensure uploads dir
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer setup: store as master.csv
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'master.csv'),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOriginsList.length && allowedOriginsList.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname && u.hostname.endsWith('.vercel.app')) return true; // allow vercel preview subdomains
  } catch (e) {}
  return false;
}

// CORS middleware
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

// Upload CSV endpoint (protected by x-upload-secret)
app.post('/api/upload-csv', upload.single('file'), (req, res) => {
  const secret = req.get('x-upload-secret') || '';
  if (!UPLOAD_SECRET || secret !== UPLOAD_SECRET) {
    // remove uploaded file if present
    if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch(e){} }
    return res.status(403).json({ error: 'Invalid upload secret' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  return res.json({ ok: true, path: `/uploads/${req.file.filename}` });
});

// Helper: read & parse uploads/master.csv, return parsed array
function readCsvMaster() {
  const csvPath = path.join(UPLOAD_DIR, 'master.csv');
  if (!fs.existsSync(csvPath)) throw new Error('CSV not found');
  const raw = fs.readFileSync(csvPath, 'utf8');
  // Papa.parse (node): header true to get objects
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length) {
    throw new Error('CSV parse error: ' + JSON.stringify(parsed.errors));
  }
  return parsed.data;
}

// Serve CSV as JSON
app.get('/api/csv-data', (req, res) => {
  try {
    const data = readCsvMaster();
    res.json({ ok: true, rows: data });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

// Forward bookkeeping POSTs to Apps Script (TARGET_URL)
app.post('/api/bookkeeping', async (req, res) => {
  const origin = req.get('Origin') || '';
  if (origin && !originAllowed(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  if (!TARGET_URL) {
    return res.status(500).json({ error: 'TARGET_URL (Apps Script URL) not configured' });
  }

  try {
    const forwardHeaders = {
      'Content-Type': req.get('Content-Type') || 'application/json',
    };

    const r = await fetch(TARGET_URL, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(req.body),
    });

    const text = await r.text();
    // ensure CORS header included
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(r.status).send(text);
  } catch (err) {
    console.error('Proxy error:', err);
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(502).json({ error: 'Bad gateway', details: err.message });
  }
});

app.get('/', (req, res) => res.send(`Proxy alive. Proxying to ${TARGET_URL || '<TARGET_URL not set>'}`));

app.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}`);
  console.log(`Proxying to ${TARGET_URL || '<TARGET_URL not set>'}`);
});
