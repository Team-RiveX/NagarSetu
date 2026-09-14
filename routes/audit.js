const express = require('express');
const ledger = require('../utils/ledger');

const router = express.Router();

// GET /api/audit/verify — recomputes the entire hash chain from the raw
// history rows and reports whether it's intact. Genuinely re-derives every
// hash; doesn't just trust what's stored.
router.get('/verify', (req, res) => {
  res.json(ledger.verifyChain());
});

module.exports = router;
