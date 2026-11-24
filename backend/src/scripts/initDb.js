// Creates tables/views and (re)loads roles + permissions. Safe to run repeatedly.
const fs = require('fs');
const { config, assertConfig } = require('../config');
const db = require('../db');
const { PERMISSIONS, ROLES } = require('../permissions');

async function initDb() {
  assertConfig();
  await db.query(fs.readFileSync(config.schemaFile, 'utf8'));
  await db.tx(async (c) => {
    for (const [code, description] of Object.entries(PERMISSIONS)) {
      await c.query(
        `INSERT INTO permissions (code, description) VALUES ($1,$2)
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`,
        [code, description]
      );
    }
    for (const [name, r] of Object.entries(ROLES)) {
      const { rows } = await c.query(
        `INSERT INTO roles (name, label, description) VALUES ($1,$2,$3)
         ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description
         RETURNING id`,
        [name, r.label, r.description]
      );
      await c.query('DELETE FROM role_permissions WHERE role_id = $1', [rows[0].id]);
      await c.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = ANY($2)`,
        [rows[0].id, r.permissions]
      );
    }
  });
}

module.exports = { initDb };

if (require.main === module) {
  initDb()
    .then(() => console.log('Database schema, roles and permissions are up to date.'))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
