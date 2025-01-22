const express = require('express');
const mysql = require('mysql2/promise');

const router = express.Router();
const dotnenv = require('dotenv');
dotnenv.config()
// Create a connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Route to fetch doctors grouped by department
router.get('/doctors', async (req, res) => {
  try {
    // Query to fetch doctors grouped by department
    const [rows] = await pool.query(`
      SELECT department GROUP_CONCAT(name) AS doctors
      FROM doctors
      GROUP BY department
    `);

    // Transform the result into an object grouped by department
    const result = rows.reduce((acc, row) => {
      acc[row.department] = row.doctors.split(',');
      return acc;
    }, {});

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching doctors:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch doctors' });
  }
});

module.exports = router;
