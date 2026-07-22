// auth.js
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly at boot rather than silently signing tokens with `undefined`.
  throw new Error('JWT_SECRET environment variable is required.');
}

// Super admin credential — deliberately NOT in the database, per the
// "super admin: code-level access" requirement. Read from env at deploy
// time only; never exposed via any API response.
const SUPER_ADMIN_KEY = process.env.SUPER_ADMIN_KEY;

/**
 * Verifies the scorer passcode submitted in the request body against the
 * single global passcode row. Does not issue a long-lived session token;
 * per the design (Screens 117-120) the passcode is checked at the start of
 * each "Create new match" flow, so this middleware is intentionally simple
 * — it just gates the route, the client re-sends the passcode each time it
 * needs to perform a scoring action that requires it.
 */
async function requireScorerPasscode(req, res, next) {
  const { passcode } = req.body;
  if (!passcode || typeof passcode !== 'string') {
    return res.status(400).json({ error: 'Passcode is required.' });
  }
  try {
    const { rows } = await pool.query('SELECT passcode FROM scorer_passcode WHERE id = 1');
    if (rows.length === 0) {
      return res.status(500).json({ error: 'No scorer passcode configured.' });
    }
    // NOTE: passcode is stored encrypted-at-rest in app logic (see schema
    // comment), not hashed one-way, because the admin UI needs to display
    // it in plaintext ("App access passcode: 1971" with a copy button).
    // Swap this comparison for your chosen reversible-encryption scheme;
    // a placeholder plaintext compare is used here pending that decision.
    if (rows[0].passcode !== passcode) {
      return res.status(401).json({ error: 'Incorrect passcode.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Verifies a valid admin JWT in the Authorization header.
 */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing admin token.' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return res.status(403).json({ error: 'Insufficient privileges.' });
    }
    req.adminRole = payload.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired admin token.' });
  }
}

/**
 * Verifies the super admin key (sent once, e.g. via a one-time setup route
 * or directly in a protected admin-recovery endpoint). This exists purely
 * to satisfy "super admin can reset the password from code" — it is meant
 * to be used rarely, e.g. via a CLI script or a route gated behind an
 * environment-only secret, not part of normal app traffic.
 */
function requireSuperAdminKey(req, res, next) {
  if (!SUPER_ADMIN_KEY) {
    return res.status(500).json({ error: 'Super admin key not configured on server.' });
  }
  const provided = req.headers['x-super-admin-key'];
  if (provided !== SUPER_ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid super admin key.' });
  }
  next();
}

function signAdminToken(role = 'admin') {
  return jwt.sign({ role }, JWT_SECRET, { expiresIn: '12h' });
}

module.exports = {
  requireScorerPasscode,
  requireAdmin,
  requireSuperAdminKey,
  signAdminToken,
};
