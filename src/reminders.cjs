/* reminders.cjs - reminder router with nodemailer + cron */
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const router = express.Router();
const REMINDERS_FILE = path.join(__dirname, 'reminders.json');

// ensure reminders file exists
if (!fs.existsSync(REMINDERS_FILE)) {
  try { fs.writeJsonSync(REMINDERS_FILE, []); } catch (e) { console.warn('Could not create reminders.json', e); }
}

// transporter - requires env vars in Render
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function loadReminders() {
  try { return await fs.readJson(REMINDERS_FILE); } catch { return []; }
}
async function saveReminders(list) { await fs.writeJson(REMINDERS_FILE, list, { spaces: 2 }); }

router.get('/', async (req, res) => {
  const list = await loadReminders();
  res.json({ ok: true, count: list.length, reminders: list });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  if (!body.companyNo && !body.companyName)
    return res.status(400).json({ error: 'companyNo or companyName required' });

  const list = await loadReminders();
  const key = body.companyNo || (body.companyName + '::' + (body.reference || ''));
  const idx = list.findIndex(r => r.key === key);
  const entry = {
    key,
    companyNo: body.companyNo || '',
    companyName: body.companyName || '',
    bookkeeper: body.bookkeeper || '',
    bookkeeperEmail: body.bookkeeperEmail || body.email || '',
    status: body.status || '',
    period: body.period || '',
    reference: body.reference || '',
    active: body.status !== 'Completed',
    lastNotifiedAt: null,
    createdAt: new Date().toISOString()
  };

  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);

  await saveReminders(list);

  // ✅ Immediately send test email to you upon creation
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: 'rajawatanubhav4@gmail.com', // 👈 Your email for testing
      subject: `New Reminder Created: ${entry.companyName || entry.companyNo}`,
      text: `A new reminder has been created.\n
Bookkeeper: ${entry.bookkeeper || 'N/A'}\n
Company: ${entry.companyName || 'N/A'} (${entry.companyNo || 'N/A'})\n
Status: ${entry.status || 'N/A'}\n
Period: ${entry.period || 'N/A'}\n
Reference: ${entry.reference || 'N/A'}\n
Created At: ${entry.createdAt}\n
\nThis is a test email sent automatically when a reminder is created.`
    });
    console.log('✅ Immediate email sent to you for', entry.companyName || entry.companyNo);
  } catch (err) {
    console.error('❌ Error sending immediate email:', err.message || err);
  }

  res.json({ success: true, entry });
});

router.post('/complete', async (req, res) => {
  const { companyNo, companyName } = req.body || {};
  if (!companyNo && !companyName)
    return res.status(400).json({ error: 'companyNo or companyName required' });

  const list = await loadReminders();
  for (const r of list) {
    if (r.companyNo === companyNo || r.companyName === companyName) {
      r.active = false;
      r.status = 'Completed';
    }
  }
  await saveReminders(list);
  res.json({ success: true });
});

async function sendRemindersOnce() {
  const list = await loadReminders();
  for (const r of list) {
    if (!r.active) continue;
    const to = r.bookkeeperEmail || r.email;
    if (!to) continue;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: 'rajawatanubhav4@gmail.com', // 👈 Still routed to you for now
        subject: `Reminder: ${r.companyName || r.companyNo} pending`,
        text: `Reminder for ${r.companyName || r.companyNo}\n
Status: ${r.status || 'N/A'}\nPeriod: ${r.period || 'N/A'}`
      });

      r.lastNotifiedAt = new Date().toISOString();
      console.log('✅ Sent scheduled reminder for', r.companyName || r.companyNo);
    } catch (err) {
      console.error('❌ Failed to send reminder for', r.companyName || r.companyNo, err.message || err);
    }
  }
  await saveReminders(list);
}

router.get('/send-now', async (req, res) => {
  try {
    await sendRemindersOnce();
    res.json({ ok: true, message: 'send-now executed' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 🕘 daily cron at 09:00
cron.schedule('0 9 * * *', async () => {
  console.log('Running daily reminders cron...');
  try { await sendRemindersOnce(); }
  catch (e) { console.error('Cron error', e); }
});

module.exports = router;
