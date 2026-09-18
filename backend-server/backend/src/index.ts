import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './config/db.js';

// Import routers
import coursesRouter from './modules/courses/courses.routes.js';
import studentsRouter from './modules/students/students.routes.js';
import enrollmentsRouter from './modules/enrollments/enrollments.routes.js';
import paymentsRouter from './modules/payments/payments.routes.js';
import notificationsRouter from './modules/notifications/notifications.routes.js';
import settingsRouter from './modules/settings/settings.routes.js';
import reportTemplatesRouter from './modules/reportTemplates/reportTemplates.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Basic health check route
app.get('/', (req, res) => {
  res.json({ message: 'CRM Backend API is running successfully.' });
});

// Register API modules routes
app.use('/api/courses', coursesRouter);
app.use('/api/students', studentsRouter);
app.use('/api/enrollments', enrollmentsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/report-templates', reportTemplatesRouter);

async function startServer() {
  try {
    const connection = await pool.getConnection();
    console.log('Successfully connected to MySQL database:', process.env.DB_NAME || 'eco_crm');
    connection.release();
  } catch (error) {
    // Resilient startup: stay up so health checks / OCR and non-DB routes can still run.
    // DB-backed routes will fail per-request until MySQL is available.
    console.warn(
      'WARNING: Failed to connect to MySQL on startup — server will still listen.',
      process.env.DB_NAME || 'eco_crm',
      error instanceof Error ? error.message : error
    );
  }

  app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
  });
}

startServer();
export default app;
