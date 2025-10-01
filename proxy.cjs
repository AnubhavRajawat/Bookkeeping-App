// proxy.cjs
// Run: node proxy.cjs
// CommonJS (require) because file is .cjs

// ----------------------
// Required modules
// ----------------------
const path = require('path');
const express = require('express');
const fetch = require('node-fetch'); // v2
const fs = require('fs');
const Papa = require('papaparse');
const morgan = require('morgan'); // optional; npm i morgan
const multer = require('multer');

// ----------------------
// Config / env
// ----------------------
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const CSV_PATH = process.env.CSV_PATH || path.join(__dirname, 'uploads', 'master.csv');
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || 'localdevsecret';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'; // allowlist
console.log('[proxy] EXPECTED UPLOAD_SECRET =', UPLOAD_SECRET);

// ----------------------
// Multer setup (uploads/tmp dir)
// ----------------------
const tmpDir = path.join(__dirname, 'uploads', 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir });

// ----------------------
// Middlewares
// ----------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// logging
try { app.use(morgan('dev')); } catch (e) {
  console.log('[proxy] morgan not installed — running without request logs');
}

// --- CORS allowlist middleware ---
app.use((req, res, next) => {
  const cfg = (CORS_ORIGIN || '').trim();
  const origin = req.get('Origin');

  if (cfg === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const allowed = cfg.split(',').map(s => s.trim()).filter(Boolean);
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-upload-secret');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ----------------------
// CSV Loader
// ----------------------
let csvData = [];
function loadCsvFromDisk() {
  try {
    if (!fs.existsSync(CSV_PATH)) {
      console.warn(`[proxy] CSV file not found at: ${CSV_PATH}`);
      csvData = [];
      return { ok: false, message: `CSV not found at ${CSV_PATH}` };
    }
    const fileContents = fs.readFileSync(CSV_PATH, 'utf8');
    const parsed = Papa.parse(fileContents, { header: true, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length > 0) {
      console.warn('[proxy] CSV parse warnings:', parsed.errors.slice(0, 5));
    }
    csvData = parsed.data || [];
    console.log(`[proxy] Loaded CSV (${csvData.length} rows) from: ${CSV_PATH}`);
    return { ok: true, rows: csvData.length };
  } catch (err) {
    console.error('[proxy] Failed to load CSV:', err);
    csvData = [];
    return { ok: false, message: err.message };
  }
}
loadCsvFromDisk();
process.on('SIGHUP', () => loadCsvFromDisk());

// ----------------------
// Routes
// ----------------------

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), csvRows: csvData.length });
});

// CSV JSON
app.get('/api/csv-data', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({ rows: csvData.length, data: csvData });
});

// Raw CSV
app.get('/proxy/editor.csv', (req, res) => {
  if (!fs.existsSync(CSV_PATH)) return res.status(404).send(`CSV not found at ${CSV_PATH}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename=editor.csv');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  fs.createReadStream(CSV_PATH).pipe(res);
});

// Static folder
app.use('/proxy/files', express.static(path.dirname(CSV_PATH), { index: false }));

// Reload CSV
app.get('/api/reload-csv', (req, res) => {
  const result = loadCsvFromDisk();
  if (result.ok) return res.json({ success: true, rows: result.rows });
  return res.status(500).json({ success: false, error: result.message });
});

// Proxy to Apps Script
app.post('/api/bookkeeping', async (req, res) => {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID')) {
    return res.status(500).json({ proxied: false, error: 'APPS_SCRIPT_URL not configured' });
  }
  try {
    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    let appsResp;
    try { appsResp = await upstream.json(); }
    catch { appsResp = { rawText: await upstream.text(), status: upstream.status }; }
    res.json({ proxied: true, appsScriptResponse: appsResp });
  } catch (err) {
    res.status(500).json({ proxied: false, error: err.message });
  }
});

// Upload CSV (protected)
app.post('/api/upload-csv', upload.single('file'), (req, res) => {
  try {
    const incomingSecret = req.get('x-upload-secret');
    if (!incomingSecret || incomingSecret !== UPLOAD_SECRET) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'Missing file' });

    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const destPath = path.join(uploadsDir, 'master.csv');
    fs.renameSync(req.file.path, destPath);

    const r = loadCsvFromDisk();
    if (r.ok) return res.json({ success: true, message: 'CSV uploaded and reloaded', rows: r.rows });
    return res.status(500).json({ success: false, message: 'Uploaded but reload failed', error: r.message });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Root
app.get('/', (req, res) => {
  res.send(`<h3>Local proxy</h3>
    <ul>
      <li><a href="/proxy/editor.csv">Raw CSV</a></li>
      <li><a href="/api/csv-data">Parsed JSON</a></li>
      <li><a href="/api/reload-csv">Reload CSV</a></li>
      <li><a href="/api/health">Health</a></li>
    </ul>`);
});

// ----------------------
// Start server
// ----------------------
app.listen(PORT, () => {
  console.log(`✅ Proxy listening on http://localhost:${PORT}`);
});
