const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { config } = require('./config');
const { errorMiddleware, AppError } = require('./errors');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false })); // CSP is handled by the host when serving the built SPA
  app.use(cors({ origin: config.corsOrigin, credentials: false }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/data-sources', require('./routes/catalog').sources);
  app.use('/api/indicators', require('./routes/catalog').indicators);
  app.use('/api/datasets', require('./routes/datasets'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/alerts', require('./routes/alerts'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api', require('./routes/system'));

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'API endpoint not found.')));

  // Single-process production mode: serve the built React app if it exists.
  const dist = path.join(config.root, 'frontend', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorMiddleware);
  return app;
}

module.exports = { createApp };
