const express = require('express');
const { AppError, ok, wrap } = require('../errors');
const { authenticate, requirePermission } = require('../middleware/auth');
const S = require('../services/series');
const D = require('../services/dashboard');

const router = express.Router();
router.use(authenticate, requirePermission('dashboard.view'));

router.get('/filters', wrap(async (_req, res) => ok(res, await D.filterOptions())));

// Each dashboard is bound to a role on the server; administrators may open all of them.
const gate = (role) => (req, _res, next) =>
  req.user.role === role || req.user.role === 'administrator'
    ? next()
    : next(new AppError(403, 'This dashboard is not available for your role.'));

async function respond(req, res, role) {
  const filters = S.parseFilters(req.query);
  const overview = await D.buildOverview(filters);
  const out = { role, filters, ...overview };
  if (role === 'analyst') out.extras = await D.analystExtras();
  if (role === 'admin') out.extras = await D.adminExtras();
  if (role === 'management') out.extras = await D.managementExtras(overview.snapshot);
  if (role !== 'management') out.activity = await D.recentActivity(8);
  ok(res, out);
}

for (const role of ['regulator', 'analyst', 'management']) {
  router.get(`/${role}`, gate(role), wrap((req, res) => respond(req, res, role)));
}
router.get(
  '/admin',
  (req, _res, next) => (req.user.role === 'administrator' ? next() : next(new AppError(403, 'Administrators only.'))),
  wrap((req, res) => respond(req, res, 'admin'))
);

module.exports = router;
