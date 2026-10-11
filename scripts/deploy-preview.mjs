import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function validatePreview(config, migrationConfig, branch) {
  if (branch === 'main') throw new Error('Preview deployment is forbidden on main.');
  const preview = config.previews?.d1_databases;
  const targets = migrationConfig.d1_databases;
  if (preview?.length !== 1 || targets?.length !== 1) throw new Error('Exactly one preview database is required.');
  const db = preview[0], target = targets[0];
  if (db.binding !== 'DB' || target.binding !== 'PREVIEW_DB' ||
      db.database_name !== 'mkm-preview-db' || target.database_name !== db.database_name ||
      db.database_id !== '12c73edb-a179-4806-b3a3-d54d0c467a82' || target.database_id !== db.database_id ||
      target.migrations_dir !== 'migrations') throw new Error('Preview database configuration is not aligned.');
  if (config.d1_databases?.some(prod => prod.database_id === db.database_id)) throw new Error('Preview must not use a production database.');
  return db;
}

function run(args) {
  const result = spawnSync('npx', ['--no-install', 'wrangler', ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const migrationConfig = JSON.parse(readFileSync(new URL('../wrangler.preview-migrations.jsonc', import.meta.url), 'utf8'));
  validatePreview(config, migrationConfig, process.env.CF_BUILD_BRANCH);
  run(['d1', 'migrations', 'apply', 'PREVIEW_DB', '--remote', '--config', 'wrangler.preview-migrations.jsonc']);
  run(['preview']);
}
