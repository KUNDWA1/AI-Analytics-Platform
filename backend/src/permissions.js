// Single source of truth for roles and permissions. Loaded into the database by initDb
// and enforced by the authorization middleware on every API call.
const PERMISSIONS = {
  'users.manage': 'Create, edit, deactivate users and assign roles',
  'audit.view': 'View audit logs',
  'system.manage': 'Manage system configuration (demo data reset)',
  'sources.view': 'View data sources',
  'sources.manage': 'Register and edit data sources',
  'datasets.view': 'View datasets and validation results',
  'datasets.upload': 'Upload datasets',
  'datasets.process': 'Validate/map and process datasets',
  'datasets.delete': 'Archive or delete datasets',
  'indicators.view': 'View indicators',
  'indicators.manage': 'Create and edit indicators',
  'analytics.view': 'View trend analysis and stored forecasts',
  'analytics.run': 'Run forecasting and anomaly detection',
  'alerts.view': 'View alerts',
  'alerts.review': 'Review alerts and add notes',
  'reports.view': 'View and download reports',
  'reports.generate': 'Generate reports and export CSV',
  'dashboard.view': 'View dashboards',
};

const ALL = Object.keys(PERMISSIONS);

const ROLES = {
  administrator: {
    label: 'Administrator',
    description: 'Manages users, datasets, configuration and audit logs; can view all modules.',
    permissions: ALL,
  },
  analyst: {
    label: 'Data Analyst',
    description: 'Uploads and processes datasets, runs analytics and AI models, investigates anomalies.',
    permissions: [
      'sources.view', 'sources.manage', 'datasets.view', 'datasets.upload', 'datasets.process',
      'indicators.view', 'indicators.manage', 'analytics.view', 'analytics.run',
      'alerts.view', 'alerts.review', 'reports.view', 'reports.generate', 'dashboard.view',
    ],
  },
  regulator: {
    label: 'Regulator',
    description: 'Monitors digital financial activity, reviews alerts and accesses reports.',
    permissions: [
      'sources.view', 'indicators.view', 'analytics.view', 'alerts.view', 'alerts.review',
      'reports.view', 'reports.generate', 'dashboard.view',
    ],
  },
  management: {
    label: 'Management / Policymaker',
    description: 'Views high-level indicators and trends and accesses management reports.',
    permissions: ['sources.view', 'indicators.view', 'analytics.view', 'reports.view', 'reports.generate', 'dashboard.view'],
  },
};

module.exports = { PERMISSIONS, ROLES };
