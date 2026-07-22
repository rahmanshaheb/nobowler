/**
 * Logs validation issues to a JSON file for post-tournament review
 * Issues are NOT shown to scorers - this is silent admin tracking
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../logs/validation-issues.json');

function ensureLogDirectory() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function logValidationIssue(matchId, validation) {
  try {
    ensureLogDirectory();

    let issues = [];
    if (fs.existsSync(LOG_FILE)) {
      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      issues = JSON.parse(content);
    }

    // Add new issues if any
    if (validation.issues.length > 0) {
      issues.push({
        matchId,
        timestamp: new Date().toISOString(),
        issues: validation.issues,
      });

      fs.writeFileSync(LOG_FILE, JSON.stringify(issues, null, 2));
      console.log(`[VALIDATION] Logged ${validation.issues.length} issue(s) for match ${matchId}`);
    }
  } catch (err) {
    console.error('[VALIDATION] Failed to log issues:', err.message);
  }
}

function getIssuesSummary() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[VALIDATION] Failed to read issues:', err.message);
    return [];
  }
}

module.exports = { logValidationIssue, getIssuesSummary };
