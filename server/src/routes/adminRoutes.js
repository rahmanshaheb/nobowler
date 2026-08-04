// adminRoutes.js
const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAdmin);

/**
 * DELETE /api/admin/matches/:matchId
 * Soft delete — sets deleted_at rather than removing the row, so the
 * delivery ledger and audit log survive for recovery/dispute resolution.
 */
router.delete('/matches/:matchId', async (req, res, next) => {
  const { matchId } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE match SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [matchId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Match not found or already deleted.' });

    await pool.query(
      `INSERT INTO audit_log (match_id, actor, action, detail) VALUES ($1, $2, $3, $4)`,
      [matchId, `admin:${req.adminRole}`, 'match_deleted', JSON.stringify({})]
    );

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/matches/:matchId/summary
 * "Download match summary" — returns the same data as the public match
 * detail endpoint, structured for download. PDF/CSV file generation is
 * left to the frontend or a follow-up endpoint; this returns the
 * structured JSON payload the client can format into a downloadable file.
 */
router.get('/matches/:matchId/summary', async (req, res, next) => {
  const { matchId } = req.params;
  try {
    const { rows: matchRows } = await pool.query('SELECT * FROM match WHERE id = $1', [matchId]);
    if (matchRows.length === 0) return res.status(404).json({ error: 'Match not found.' });

    const { rows: battingStats } = await pool.query(
      'SELECT * FROM v_batting_stats WHERE match_id = $1 ORDER BY team, runs_scored DESC',
      [matchId]
    );
    const { rows: bowlingStats } = await pool.query('SELECT * FROM v_bowling_stats WHERE match_id = $1', [matchId]);

    res.json({ match: matchRows[0], battingStats, bowlingStats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
