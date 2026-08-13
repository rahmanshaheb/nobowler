// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const scoringRoutes = require('./routes/scoringRoutes');
const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { ScoringRuleError } = require('./utils/scoringEngine');
const { runMigrations } = require('../db/migrate');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api', scoringRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Centralized error handler. Anything thrown with a `.statusCode` uses
// that; ScoringRuleError maps to 422 (unprocessable -- a rule was
// violated, not a malformed request); everything else is a 500 and gets
// logged server-side without leaking internals to the client.
app.use((err, req, res, next) => {
  if (err instanceof ScoringRuleError) {
    return res.status(422).json({ error: err.message });
  }
  const statusCode = err.statusCode || 500;
  if (statusCode === 500) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
  res.status(statusCode).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Cricket scoring API listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to run migrations:', err);
    process.exit(1);
  });

module.exports = app;
