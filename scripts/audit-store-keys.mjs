/**
 * Lists every key in the store and reports any that the app doesn't account
 * for: not one of the per-user kinds in `src/lib/store/userKeys.ts`, not
 * under one of its shared prefixes (NASA's data, the same for everyone), and
 * not a removal marker. Removal and expiry only ever see keys that list
 * covers, so anything outside it is kept forever.
 *
 * READ-ONLY, and only the listing: it calls ListObjectsV2 and nothing else. No
 * object is read, and nothing is written or deleted. It never prints a
 * username either. Registered keys are counted, and unregistered ones are
 * reported by shape, with every name-like part masked as `<x>`.
 *
 *   R2:     node --env-file=<a file with the four R2_ variables> scripts/audit-store-keys.mjs
 *   Local:  node scripts/audit-store-keys.mjs --local   (walks DATA_DIR, default .data)
 *
 * Add --disable-warning=MODULE_TYPELESS_PACKAGE_JSON to either to quiet Node's
 * note about importing a .ts file from a package with no "type" field.
 *
 * The local mode is the positive control: a checkout whose `.data` still has
 * the flat files from before the blob layout must report them.
 *
 * Imports the app's own registry, so a kind added there is recognized here
 * without an edit. Needs Node 23.6 or later to import a .ts file directly.
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { SHARED_PREFIXES, USER_KEY_KINDS, usernameFromKey } from "../src/lib/store/userKeys.ts";

/* The one prefix that isn't per user. Kept in step with MARKER_PREFIX in
   `src/lib/removal.ts` by hand: importing that module drags in the whole app. */
const MARKER_PREFIX = "limits/removals/";

async function listR2() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  const missing = Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })
    .filter(([, v]) => !v?.trim())
    .map(([k]) => k);
  if (missing.length > 0) {
    console.error(`Missing ${missing.join(", ")}. Pass them with --env-file, or use --local.`);
    process.exit(2);
  }
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID.trim(), secretAccessKey: R2_SECRET_ACCESS_KEY.trim() },
  });
  const out = [];
  let token;
  let calls = 0;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET.trim(), ContinuationToken: token }),
    );
    calls++;
    for (const item of res.Contents ?? []) {
      out.push({ key: item.Key, size: item.Size ?? 0, modified: item.LastModified ?? null });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return { where: `R2 bucket (${calls} list call${calls === 1 ? "" : "s"})`, objects: out };
}

function listLocal() {
  const dir = process.env.DATA_DIR?.trim() || ".data";
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(key);
      else {
        const s = statSync(path.join(dir, key));
        out.push({ key, size: s.size, modified: s.mtime });
      }
    }
  };
  walk("");
  return { where: `local folder ${dir}`, objects: out };
}

const KNOWN_WORDS = new Set([
  "scrobbles", "sync", "tags", "cache", "genres", "limits", "removals",
  "jsonl", "json", "gz", "tmp",
]);
/** A key's shape with every name-like part masked, so no username prints. */
const shapeOf = (key) =>
  key
    .replace(/[A-Za-z0-9_]+/g, (word) => (KNOWN_WORDS.has(word.toLowerCase()) ? word : "<x>"))
    .replace(/<x>(?:[-_]<x>)+/g, "<x>");

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`;
const keys = (n) => `${String(n).padStart(6)} key${n === 1 ? " " : "s"}`;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "unknown");

const { where, objects } = process.argv.includes("--local") ? listLocal() : await listR2();

const kinds = Object.fromEntries(Object.keys(USER_KEY_KINDS).map((k) => [k, { count: 0, bytes: 0 }]));
const names = new Set();
const shared = Object.fromEntries(SHARED_PREFIXES.map((p) => [p, { count: 0, bytes: 0 }]));
let markers = 0;
const unregistered = new Map();

for (const { key, size, modified } of objects) {
  const name = usernameFromKey(key);
  if (name) {
    names.add(name);
    const kind = Object.entries(USER_KEY_KINDS).find(
      ([, { prefix, suffix }]) => key.startsWith(prefix) && key.endsWith(suffix),
    )[0];
    kinds[kind].count++;
    kinds[kind].bytes += size;
  } else if (SHARED_PREFIXES.some((p) => key.startsWith(p))) {
    const group = shared[SHARED_PREFIXES.find((p) => key.startsWith(p))];
    group.count++;
    group.bytes += size;
  } else if (key.startsWith(MARKER_PREFIX)) {
    markers++;
  } else {
    const shape = shapeOf(key);
    const group = unregistered.get(shape) ?? { count: 0, bytes: 0, first: null, last: null };
    group.count++;
    group.bytes += size;
    if (modified && (!group.first || modified < group.first)) group.first = modified;
    if (modified && (!group.last || modified > group.last)) group.last = modified;
    unregistered.set(shape, group);
  }
}

const total = objects.reduce((sum, o) => sum + o.size, 0);
console.log(`Listed ${objects.length} keys, ${mb(total)}, in the ${where}. Nothing was read or changed.`);
console.log(`\nPer-user keys, for ${names.size} names:`);
for (const [kind, { count, bytes }] of Object.entries(kinds)) {
  console.log(`  ${kind.padEnd(10)} ${keys(count)}  ${mb(bytes)}`);
}
console.log(`Shared, the same for everyone:`);
for (const [prefix, { count, bytes }] of Object.entries(shared)) {
  console.log(`  ${prefix.padEnd(10)} ${keys(count)}  ${mb(bytes)}`);
}
console.log(`Removal markers: ${markers}`);

const unregisteredCount = [...unregistered.values()].reduce((sum, g) => sum + g.count, 0);
if (unregisteredCount === 0) {
  console.log("\nNot registered: none. Every key is a per-user kind, shared, or a removal marker.");
} else {
  console.log(`\nNot registered: ${unregisteredCount} keys in ${unregistered.size} shapes`);
  for (const [shape, g] of [...unregistered].sort((a, b) => b[1].count - a[1].count)) {
    console.log(
      `  ${shape.padEnd(34)} ${keys(g.count)}  ${mb(g.bytes).padStart(9)}  written ${day(g.first)} to ${day(g.last)}`,
    );
  }
}
