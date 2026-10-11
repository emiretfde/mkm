import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePreview } from '../scripts/deploy-preview.mjs';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const config = read('../wrangler.jsonc');
const migrationConfig = read('../wrangler.preview-migrations.jsonc');
test('preview and migrations use the same isolated database', () => {
  assert.equal(validatePreview(config, migrationConfig, 'design/mkm-v09').database_name, 'mkm-preview-db');
});
test('preview rejects production database, wrong migration target and main branch', () => {
  const production = structuredClone(config);
  production.d1_databases[0].database_id = config.previews.d1_databases[0].database_id;
  assert.throws(() => validatePreview(production, migrationConfig, 'design/mkm-v09'));
  const wrongTarget = structuredClone(migrationConfig);
  wrongTarget.d1_databases[0].database_id = config.d1_databases[0].database_id;
  assert.throws(() => validatePreview(config, wrongTarget, 'design/mkm-v09'));
  assert.throws(() => validatePreview(config, migrationConfig, 'main'));
});
