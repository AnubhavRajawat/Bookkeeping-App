// proxy.cjs
// Express proxy + CSV upload + CSV serve + forward to Apps Script + Reminders router

/* ------------------ Imports ------------------ */
const express = require('express');
const fetch = require('node-fetch'); // v2
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

/* ------------------ App Setup ------------------ */
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

/* ------------------ Env / Config ------------------ */
const PORT = process.env.PORT || 10000;
const TARGET_URL = process.env.TARGET_URL || process.env.APPS_SCRIPT_URL || ''; // prefer TARGET_URL
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || process.env.UPLOAD_SECRET_KEY || 'super-secret';
const allowedOriginsList = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

/* ------------------ Upload / Storage ------------------ */
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'master.csv'),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

/* ------------------ CORS Helper & Middleware ------------------ */
function originAllowed(origin) {
  if (!origin) return false;
  if (allowedOriginsList.length && allowedOriginsList.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname && u.hostname.endsWith('.vercel.app')) return true; // allow vercel preview subdomains
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

/* ------------------ Upload CSV endpoint (protected) ------------------ */
app.post('/api/upload-csv', upload.single('file'), (req, res) => {
  const secret = req.get('x-upload-secret') || '';
  if (!UPLOAD_SECRET || secret !== UPLOAD_SECRET) {
    // cleanup uploaded file if present
    if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    return res.status(403).json({ error: 'Invalid upload secret' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  return res.json({ ok: true, path: `/uploads/${req.file.filename}` });
});

/* ------------------ CSV read helper ------------------ */
function readCsvMaster() {
  const csvPath = path.join(UPLOAD_DIR, 'master.csv');
  if (!fs.existsSync(csvPath)) throw new Error('CSV not found');
  const raw = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length) {
    throw new Error('CSV parse error: ' + JSON.stringify(parsed.errors));
  }
  return parsed.data;
}

/* ------------------ Serve CSV as JSON ------------------ */
app.get('/api/csv-data', (req, res) => {
  try {
    const data = readCsvMaster();
    // return consistent format used by frontend
    res.json({ ok: true, rows: data });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

/* ------------------ Forward bookkeeping POSTs to Apps Script (TARGET_URL) ------------------ */
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

    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(r.status).send(text);
  } catch (err) {
    console.error('Proxy error forwarding to TARGET_URL:', err);
    if (origin && originAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.status(502).json({ error: 'Bad gateway', details: err.message });
  }
});

/* ------------------ Mount Reminders Router ------------------ */
let mountedReminders = false;
try {
  // try common filenames
  let remindersRouter;
  const tryPaths = [
    path.join(__dirname, 'reminders.cjs'),
    path.join(__dirname, 'reminders.js'),
    path.join(__dirname, 'reminders')
  ];
  let found = null;
  for (const p of tryPaths) {
    try {
      // require() accepts relative path; convert to relative if inside same dir
      if (fs.existsSync(p)) {
        found = p;
        break;
      }
    } catch (e) {}
  }

  if (found) {
    // require via relative path from __dirname
    const rel = './' + path.basename(found);
    remindersRouter = require(rel);
    app.use('/api/reminders', remindersRouter);
    mountedReminders = true;
    console.log('✅ Mounted /api/reminders using', rel);
  } else {
    // fallback: attempt require('./reminders') and let Node throw (useful for debug)
    try {
      remindersRouter = require('./reminders');
      app.use('/api/reminders', remindersRouter);
      mountedReminders = true;
      console.log('✅ Mounted /api/reminders via ./reminders');
    } catch (e) {
      console.warn('⚠️ reminders router not found in project root. Skipping mount. Expect /api/reminders to 404. To enable, add reminders.cjs to project root.');
    }
  }
} catch (err) {
  console.error('❌ Failed to mount reminders router:', err && err.stack ? err.stack : err);
}

/* ------------------ Root / Health ------------------ */
app.get('/', (req, res) => {
  res.send({
    message: 'Proxy alive',
    proxyingTo: TARGET_URL || '<TARGET_URL not set>',
    remindersMounted: mountedReminders
  });
});

/* ------------------ Start server ------------------ */
app.listen(PORT, () => {
  console.log(`🚀 Proxy listening on port ${PORT}`);
  console.log(`🔗 Proxying to ${TARGET_URL || '<TARGET_URL not set>'}`);
  console.log(`🧩 Reminders router mounted: ${mountedReminders}`);
});
