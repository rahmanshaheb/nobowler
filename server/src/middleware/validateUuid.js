const { isValidUuid } = require('../utils/uuid');

function requireUuidParam(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      const value = req.params[name];
      if (value != null && !isValidUuid(value)) {
        return res.status(400).json({ error: `Invalid ${name}.` });
      }
    }
    next();
  };
}

module.exports = { requireUuidParam };
