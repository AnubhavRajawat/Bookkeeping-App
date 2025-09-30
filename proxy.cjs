// proxy.cjs
// Run: node proxy.cjs
// CommonJS (require) because file is .cjs

const express = require('express');
const fetch = require('node-fetch'); // v2
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const morgan = require('morgan'); // optional but helpful; npm i morgan
const cors = require('cors');

const app = express();

// Config via env
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const CSV_PATH = process.env.CSV_PATH || path.join(__dirname, 'uploads', 'master.csv'); // default
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzFLKP9Tji3waC4xaYrbuhEllDaM5jT5yJjlKbDl18VhFpDRTxtQIgOLpO7X8bxFw2Z/exec';

// Middlewares
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Use morgan if available for better request logging (install with npm i morgan)
try {
  app.use(morgan('dev'));
} catch (e) {
  // ignore if morgan not installed
  console.log('[proxy] morgan not installed — running without detailed request logs. (npm i morgan for nicer logs)');
}

// CORS: allow all origins for dev; restrict in production
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// In-memory parsed CSV
let csvData = [];

// Load CSV helper
function loadCsvFromDisk() {
  try {
    if (!fs.existsSync(CSV_PATH)) {
      console.warn(`[proxy] CSV file not found at: ${CSV_PATH}`);
      csvData = [];
      return { ok: false, message: `CSV not found at ${CSV_PATH}` };
    }
    const fileContents = fs.readFileSync(CSV_PATH, 'utf8');
    const parsed = Papa.parse(fileContents, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });

    if (parsed.errors && parsed.errors.length > 0) {
      console.warn('[proxy] CSV parse errors/warnings (first 5):', parsed.errors.slice(0, 5));
      // we continue and set parsed.data if available
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

// Initial load
loadCsvFromDisk();

// Watch for SIGHUP to reload CSV without restarting (optional)
process.on('SIGHUP', () => {
  console.log('[proxy] Received SIGHUP - reloading CSV from disk...');
  loadCsvFromDisk();
});

// Routes

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), csvRows: csvData.length });
});

// Serve parsed CSV as JSON to frontend
app.get('/api/csv-data', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // No cache for dev
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({ rows: csvData.length, data: csvData });
});

// Serve raw CSV for direct download / CSV parsers in-browser
app.get('/proxy/editor.csv', (req, res) => {
  if (!fs.existsSync(CSV_PATH)) {
    return res.status(404).send(`CSV not found at ${CSV_PATH}`);
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename=editor.csv'); // or attachment
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const stream = fs.createReadStream(CSV_PATH);
  stream.on('error', (err) => {
    console.error('[proxy] Error streaming CSV:', err);
    if (!res.headersSent) res.status(500).send('Error reading CSV');
  });
  stream.pipe(res);
});

// Static directory listing for quick inspection: /proxy/files/*
app.use('/proxy/files', express.static(path.dirname(CSV_PATH), {
  index: false,
  extensions: ['csv', 'txt', 'json'],
}));

// Manual reload endpoint
app.get('/api/reload-csv', (req, res) => {
  const result = loadCsvFromDisk();
  if (result.ok) return res.json({ success: true, rows: result.rows });
  return res.status(500).json({ success: false, error: result.message || 'Failed to reload CSV' });
});

// Proxy to Apps Script for form submissions
app.post('/api/bookkeeping', async (req, res) => {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID_HERE')) {
    return res.status(500).json({ proxied: false, error: 'APPS_SCRIPT_URL not configured in env' });
  }

  try {
    console.log('[proxy] Forwarding payload to Apps Script — keys:', Object.keys(req.body).slice(0, 10));
    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    // Try to parse JSON; fallback to text
    let appsResp;
    try {
      appsResp = await upstream.json();
    } catch (e) {
      appsResp = { rawText: await upstream.text().catch(() => ''), status: upstream.status };
    }
    console.log('[proxy] Apps Script responded with status', upstream.status);
    res.status(200).json({ proxied: true, appsScriptResponse: appsResp });
  } catch (err) {
    console.error('[proxy] Error forwarding to Apps Script:', err);
    res.status(500).json({ proxied: false, error: err.message });
  }
});

// Root UI / quick links
app.get('/', (req, res) => {
  res.send(`
    <h3>Local proxy</h3>
    <ul>
      <li><a href="/proxy/editor.csv">/proxy/editor.csv (raw CSV)</a></li>
      <li><a href="/proxy/files/">/proxy/files/ (static folder)</a></li>
      <li><a href="/api/csv-data">/api/csv-data (parsed JSON)</a></li>
      <li><a href="/api/reload-csv">/api/reload-csv (reload CSV)</a></li>
      <li><a href="/api/health">/api/health</a></li>
    </ul>
    <p>CSV path: <code>${CSV_PATH}</code></p>
    <p>Apps Script URL: <code>${APPS_SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID_HERE') ? 'NOT CONFIGURED' : 'configured'}</code></p>
  `);
});

// Start
app.listen(PORT, () => {
  console.log(`✅ Proxy listening on http://localhost:${PORT}`);
  console.log(`   Raw CSV: http://localhost:${PORT}/proxy/editor.csv`);
  console.log(`   Parsed JSON: http://localhost:${PORT}/api/csv-data`);
  console.log(`   Reload CSV: http://localhost:${PORT}/api/reload-csv`);
  if (APPS_SCRIPT_URL.includes('YOUR_DEPLOYMENT_ID_HERE')) {
    console.warn('⚠️ APPS_SCRIPT_URL is not configured. Set env APPS_SCRIPT_URL to your Apps Script /exec URL.');
  }
});
