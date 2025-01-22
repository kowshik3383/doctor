const express = require('express');
const router = express.Router();
const db = require('./db');

// Fetch all users from the hospital table
router.get('/hospitals', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM hospitals');
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hospitals', details: err });
  }
});

// Add a new appointment
router.post('/appointments', async (req, res) => {
  const { patient_id, hospital_id, doctor_id, appointment_date, status } = req.body;

  try {
    const [result] = await db.query(
      'INSERT INTO appointments (patient_id, hospital_id, doctor_id, appointment_date, status) VALUES (?, ?, ?, ?, ?)',
      [patient_id, hospital_id, doctor_id, appointment_date, status]
    );
    res.status(201).json({ message: 'Appointment created successfully', appointmentId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create appointment', details: err });
  }
});

// Fetch all appointments
router.get('/appointments', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.id, a.appointment_date, a.status, p.name AS patient_name, d.name AS doctor_name, h.name AS hospital_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN hospital h ON a.hospital_id = h.id
    `);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointments', details: err });
  }
});

// Update appointment status
router.put('/appointments/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    await db.query('UPDATE appointments SET status = ? WHERE id = ?', [status, id]);
    res.status(200).json({ message: 'Appointment updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update appointment', details: err });
  }
});

// Delete an appointment
router.delete('/appointments/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM appointments WHERE id = ?', [id]);
    res.status(200).json({ message: 'Appointment deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete appointment', details: err });
  }
});

module.exports = router;
