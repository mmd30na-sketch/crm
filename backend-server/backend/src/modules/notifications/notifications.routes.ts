import { Router } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const router = Router();

// POST /api/notifications/welcome
router.post('/welcome', async (req, res) => {
  try {
    const { student_id, phone_number, first_name, last_name } = req.body;

    console.log(`[Notification] Dispatching welcome message for student: ${first_name} ${last_name} (${phone_number})`);

    // Dispatch webhook if configured
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        // Fetch API is globally available in Node.js 18+
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'student_registered',
            student_id,
            phone_number,
            first_name,
            last_name
          })
        });
        console.log(`[Notification] Webhook dispatched to ${webhookUrl}`);
      } catch (err) {
        console.error(`[Notification] Webhook dispatch failed:`, err);
      }
    }

    res.json({ success: true, message: 'Welcome notifications triggered successfully' });
  } catch (error) {
    console.error('Error in welcome notification:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
