/**
 * Validates that match stats have proper correlation:
 * - Total wickets = sum of individual dismissals = sum of bowler wickets
 * - All dismissals have valid bowling_spell_id (not NULL)
 *
 * Returns { isValid, issues: [] }
 */
async function validateMatchData(matchId, pool) {
  const issues = [];

  // Get innings
  const { rows: innings } = await pool.query(
    `SELECT id, innings_number, batting_team, total_wickets FROM innings WHERE match_id = $1 ORDER BY innings_number`,
    [matchId]
  );

  for (const inning of innings) {
    // Count dismissals in delivery table with is_wicket=true
    const { rows: dismissalCount } = await pool.query(
      `SELECT COUNT(*) as count FROM delivery WHERE innings_id = $1 AND is_wicket = true AND is_undone = false`,
      [inning.id]
    );
    const totalDismissals = Number(dismissalCount[0].count);

    // Count dismissals with valid bowling_spell_id
    const { rows: linkedDismissals } = await pool.query(
      `SELECT COUNT(*) as count FROM delivery WHERE innings_id = $1 AND is_wicket = true AND is_undone = false AND bowling_spell_id IS NOT NULL`,
      [inning.id]
    );
    const linkedCount = Number(linkedDismissals[0].count);

    // Sum of bowler credited wickets
    const { rows: bowlerWickets } = await pool.query(
      `SELECT COALESCE(SUM(total_wickets_in_spell), 0) as total FROM bowling_spell WHERE innings_id = $1`,
      [inning.id]
    );
    const bowlerTotal = Number(bowlerWickets[0].total);

    const inningsTotal = Number(inning.total_wickets);

    // Check correlations
    if (totalDismissals !== inningsTotal) {
      issues.push({
        innings: inning.innings_number,
        type: 'MISSING_DISMISSALS',
        message: `Innings ${inning.innings_number}: Expected ${inningsTotal} dismissals, found ${totalDismissals}`,
      });
    }

    if (linkedCount !== totalDismissals) {
      issues.push({
        innings: inning.innings_number,
        type: 'UNLINKED_DISMISSALS',
        severity: 'CRITICAL',
        message: `Innings ${inning.innings_number}: ${totalDismissals - linkedCount} dismissal(s) missing bowling_spell_id (data storage bug!)`,
      });
    }

    if (bowlerTotal !== inningsTotal) {
      issues.push({
        innings: inning.innings_number,
        type: 'BOWLER_CREDIT_MISMATCH',
        message: `Innings ${inning.innings_number}: Bowler wickets (${bowlerTotal}) ≠ Total wickets (${inningsTotal})`,
      });
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

module.exports = { validateMatchData };
