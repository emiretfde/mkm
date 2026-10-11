import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePreview } from './deploy-preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
validatePreview(read('../wrangler.jsonc'), read('../wrangler.preview-migrations.jsonc'), process.env.CF_BUILD_BRANCH);
const password = process.env.MKM_PREVIEW_ADMIN_PASSWORD;
if (!password) {
  console.log('Preview admin not provisioned: MKM_PREVIEW_ADMIN_PASSWORD is not set.');
} else {
  if (password.length < 12 || password.length > 128) throw new Error('Preview admin password must have 12 to 128 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 20000, 32, 'sha256').toString('hex');
  const directory = mkdtempSync(join(tmpdir(), 'mkm-preview-admin-'));
  try {
    const file = join(directory, 'admin.sql');
    // Create only in an empty test database. Never reset existing passwords.
    // This file contains a salted hash, never the plaintext password, and is removed below.
    writeFileSync(file, "INSERT INTO users(id,email,display_name,role,password_salt,password_hash,iterations) SELECT 'preview-admin','preview-admin@mkm.test','Testni administrator','admin','" + salt + "','" + hash + "',20000 WHERE NOT EXISTS(SELECT 1 FROM users);", { mode: 0o600 });
    const result = spawnSync('npx', ['--no-install','wrangler','d1','execute','PREVIEW_DB','--remote','--config','wrangler.preview-migrations.jsonc','--file',file], { cwd: root, stdio: ['ignore','pipe','pipe'] });
    if (result.error || result.status !== 0) throw new Error('Preview admin provisioning failed. Check D1 access for the build token.');
    console.log('Preview admin provisioning completed for the isolated test database.');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
