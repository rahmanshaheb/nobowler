// authRoutes.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { signAdminToken, requireAdmin, requireSuperAdminKey } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/scorer-passcode/verify
 * Checks a passcode without exposing whether one already exists.
 */
router.post('/scorer-passcode/verify', async (req, res, next) => {
  const { passcode } = req.body;
  if (!passcode) return res.status(400).json({ error: 'passcode is required.' });
  try {
    const { rows } = await pool.query('SELECT passcode FROM scorer_passcode WHERE id = 1');
    if (rows.length === 0) return res.status(500).json({ error: 'No passcode configured.' });
    const valid = rows[0].passcode === passcode; // see auth.js note on encryption-at-rest
    res.json({ valid });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/admin/login
 */
router.post('/admin/login', async (req, res, next) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required.' });
  try {
    const { rows } = await pool.query('SELECT password_hash FROM admin_account WHERE id = 1');
    if (rows.length === 0) return res.status(500).json({ error: 'No admin account configured.' });
    const match = await bcrypt.compare(password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });
    const token = signAdminToken('admin');
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/auth/admin/scorer-passcode
 * Admin changes the global scorer passcode (Screens 117-120).
 */
router.patch('/admin/scorer-passcode', requireAdmin, async (req, res, next) => {
  const { newPasscode } = req.body;
  if (!newPasscode || !/^\d{4}$/.test(newPasscode)) {
    return res.status(400).json({ error: 'newPasscode must be a 4-digit string.' });
  }
  try {
    await pool.query(
      `UPDATE scorer_passcode SET passcode = $1, updated_at = now() WHERE id = 1`,
      [newPasscode]
    );
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// Admin password is currently fixed ("noBowlers", set via the seed
// script — see db/seed.js) and NOT changeable through the app.
// PATCH /admin/password and POST /admin/forgot-password were removed
// deliberately, not just gated, per explicit instruction to disable this
// functionality. To restore later: bring back the two handlers below
// (last present in this file before this comment block), and re-link the
// "Forgot password" / "Change admin password" UI affordances on the
// frontend, which should currently be hidden or removed to match.
// ----------------------------------------------------------------

/**
 * POST /api/auth/super-admin/reset-scorer-passcode
 * Emergency recovery path gated by an environment-only key, never exposed
 * in the normal app UI. Satisfies "super admin can reset the password
 * from code."
 */
router.post('/super-admin/reset-scorer-passcode', requireSuperAdminKey, async (req, res, next) => {
  const { newPasscode } = req.body;
  if (!newPasscode || !/^\d{4}$/.test(newPasscode)) {
    return res.status(400).json({ error: 'newPasscode must be a 4-digit string.' });
  }
  try {
    await pool.query(`UPDATE scorer_passcode SET passcode = $1, updated_at = now() WHERE id = 1`, [newPasscode]);
    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
