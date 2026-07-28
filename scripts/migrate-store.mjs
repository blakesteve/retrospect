// One-time migration: flat .data files (scrobbles-<user>.jsonl, sync-<user>.json,
// tags-<user>.json) into the blob-store layout (scrobbles/<user>.jsonl.gz,
// sync/<user>.json, tags/<user>.json). Run once after upgrading; safe to
// re-run (skips anything already migrated). Originals are left in place.
//
// Usage: node scripts/migrate-store.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const dir = process.env.DATA_DIR ?? '.data';
if (!existsSync(dir)) {
  console.log(`No ${dir}/ directory; nothing to migrate.`);
  process.exit(0);
}

let migrated = 0;
for (const file of readdirSync(dir)) {
  let target = null;
  let transform = (buf) => buf;

  if (/^scrobbles-(.+)\.jsonl$/.test(file)) {
    target = path.join('scrobbles', file.replace(/^scrobbles-/, '').replace(/\.jsonl$/, '.jsonl.gz'));
    transform = (buf) => gzipSync(buf);
  } else if (/^sync-(.+)\.json$/.test(file)) {
    target = path.join('sync', file.replace(/^sync-/, ''));
  } else if (/^tags-(.+)\.json$/.test(file)) {
    target = path.join('tags', file.replace(/^tags-/, ''));
  }
  if (!target) continue;

  const dest = path.join(dir, target);
  if (existsSync(dest)) {
    console.log(`skip (exists): ${target}`);
    continue;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, transform(readFileSync(path.join(dir, file))));
  console.log(`migrated: ${file} -> ${target}`);
  migrated++;
}
console.log(migrated ? `Done: ${migrated} file(s) migrated.` : 'Nothing new to migrate.');
