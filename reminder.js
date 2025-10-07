// reminders.js
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const router = express.Router();
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');

// Ensure storage file exists
fs.ensureFileSync(REMINDERS_FILE);

// --- Email transporter ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true', // true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// --- Helper functions ---
async function loadReminders() {
  try {
    const data = await fs.readJson(REMINDERS_FILE);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveReminders(list) {
  await fs.writeJson(REMINDERS_FILE, list, { spaces: 2 });
}

// Register or update reminder
router.post('/', async (req, res) => {
  const record = req.body || {};
  if (!record.companyNo && !record.companyName) {
    return res.status(400).json({ error: 'Missing companyNo or companyName' });
  }

  const reminders = await loadReminders();
  const idx = reminders.findIndex(
    (r) => r.companyNo === record.companyNo || r.companyName === record.companyName
  );

  const newEntry = {
    ...record,
    id: record.companyNo || record.companyName,
    lastNotifiedAt: null,
    active: true,
    createdAt: new Date().toISOString(),
  };

  if (idx >= 0) reminders[idx] = newEntry;
  else reminders.push(newEntry);

  await saveReminders(reminders);
  res.json({ success: true });
});

// Mark reminder complete (stop notifications)
router.post('/complete', async (req, res) => {
  const { companyNo, companyName } = req.body || {};
  if (!companyNo && !companyName) {
    return res.status(400).json({ error: 'Missing identifier' });
  }

  const reminders = await loadReminders();
  reminders.forEach((r) => {
    if (r.companyNo === companyNo || r.companyName === companyName) r.active = false;
  });

  await saveReminders(reminders);
  res.json({ success: true });
});

// List all reminders
router.get('/', async (req, res) => {
  const reminders = await loadReminders();
  res.json(reminders);
});

// --- Daily cron job for email reminders ---
async function sendReminders() {
  const reminders = await loadReminders();
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  let sentCount = 0;

  for (const r of reminders) {
    if (!r.active) continue;
    if (!r.bookkeeperEmail && !r.email) continue;

    const lastSent = r.lastNotifiedAt ? r.lastNotifiedAt.slice(0, 10) : null;
    if (lastSent === today) continue; // skip already sent today

    const to = r.bookkeeperEmail || r.email;
    const subject = `Reminder: ${r.companyName || r.companyNo} still pending`;
    const text = `Hi ${r.bookkeeper || 'Team'},\n\n` +
      `This is a reminder that the bookkeeping task for "${r.companyName || r.companyNo}" is still pending.\n\n` +
      `Status: ${r.status || 'N/A'}\n` +
      `Period: ${r.period || 'N/A'}\n\n` +
      `Please complete or update the status if already done.\n\n` +
      `- Automated Bookkeeping Reminder Bot`;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
      });

      r.lastNotifiedAt = now.toISOString();
      sentCount++;
      console.log(`✅ Reminder sent to ${to} for ${r.companyName || r.companyNo}`);
    } catch (err) {
      console.error(`❌ Failed to send reminder to ${to}:`, err.message);
    }
  }

  await saveReminders(reminders);
  if (sentCount) console.log(`📧 Sent ${sentCount} reminders on ${today}`);
}

// Run every day at 9 AM server time
cron.schedule('0 9 * * *', () => {
  console.log('Running daily reminder cron at 9 AM...');
  sendReminders().catch((e) => console.error('Cron error:', e));
});

module.exports = router;
