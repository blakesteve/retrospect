import { mkdir, readFile, readdir, rename, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { R2BlobStore } from "./r2";

/**
 * The storage boundary, distilled: named blobs, whole-object reads and
 * writes. This maps onto a local folder for dev, Cloudflare R2 (S3 API) in
 * production, and plain memory in tests. Everything the app persists —
 * scrobble histories, sync state, tag caches, analysis caches — goes
 * through this interface, so swapping backends is an env var, not a rewrite.
 */
export interface BlobStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer): Promise<void>;
  del(key: string): Promise<void>;
  /** Whether a blob exists, without reading it: a history can be 7MB. */
  has(key: string): Promise<boolean>;
  /** Every key starting with `prefix`, with when it was last written (unix
      ms). Removal's rate limit and the expiry sweep need both, and R2 lists
      with strong consistency, so a key written a moment ago is always seen. */
  list(prefix: string): Promise<BlobListing[]>;
}

export interface BlobListing {
  key: string;
  lastModified: number;
}

/** Local-folder implementation: the default for `npm run dev`. */
export class FsBlobStore implements BlobStore {
  /* `||`, not `??`: `??` passes an empty `DATA_DIR` through, and `path.join("",
     "sync/x.json")` is "sync/x.json", so every blob lands relative to the
     process working directory instead of inside `.data`. Reads and writes both
     agree on the wrong place, so it looks like it works until something else
     needs to find the folder. `dir` is readable so the test can assert which
     path was chosen. */
  constructor(readonly dir = process.env.DATA_DIR?.trim() || ".data") {}

  private pathFor(key: string): string {
    // Keys are internal and already safe, but never trust a path join.
    return path.join(this.dir, key.replace(/[^a-zA-Z0-9._/-]/g, "_"));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, p); // atomic-ish: no torn reads
  }

  async del(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // already gone is fine
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<BlobListing[]> {
    // Walk only the folder the prefix names, then match the rest by name.
    const folder = prefix.slice(0, prefix.lastIndexOf("/") + 1);
    const out: BlobListing[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(path.join(this.dir, rel), { withFileTypes: true });
      } catch {
        return; // no folder, no keys
      }
      for (const entry of entries) {
        const key = rel + entry.name;
        if (entry.isDirectory()) await walk(`${key}/`);
        // A `.tmp` is a write in progress, not a blob.
        else if (key.startsWith(prefix) && !key.endsWith(".tmp")) {
          out.push({ key, lastModified: (await stat(path.join(this.dir, key))).mtimeMs });
        }
      }
    };
    await walk(folder);
    return out;
  }
}

/** In-memory implementation for tests. A blob's write time is `Date.now()`,
    so tests move it with fake timers. */
export class MemoryBlobStore implements BlobStore {
  private blobs = new Map<string, { data: Buffer; lastModified: number }>();

  async get(key: string): Promise<Buffer | null> {
    return this.blobs.get(key)?.data ?? null;
  }
  async put(key: string, data: Buffer): Promise<void> {
    this.blobs.set(key, { data: Buffer.from(data), lastModified: Date.now() });
  }
  async del(key: string): Promise<void> {
    this.blobs.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.blobs.has(key);
  }
  async list(prefix: string): Promise<BlobListing[]> {
    return [...this.blobs]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, { lastModified }]) => ({ key, lastModified }));
  }
}

let active: BlobStore | null = null;

/**
 * The production bucket. Only a production deployment may use it: a preview
 * pointed here would write test data into real listeners' records, and a
 * removal tried on a preview would delete them. Previews use
 * `retrospect-preview`. This replaces checking a preview's settings by hand.
 * Off Vercel (`VERCEL_ENV` unset) nothing is enforced.
 */
export const PRODUCTION_BUCKET = "retrospect";

/** Backend selection: R2 when its env vars are present, local folder otherwise. */
export function getBlobStore(): BlobStore {
  if (active) return active;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, VERCEL_ENV } = process.env;

  if (VERCEL_ENV && VERCEL_ENV !== "production" && R2_BUCKET?.trim() === PRODUCTION_BUCKET) {
    throw new Error(
      `This ${VERCEL_ENV} deployment is set to the production bucket (${PRODUCTION_BUCKET}). ` +
        `Point its R2_BUCKET at retrospect-preview in Vercel and redeploy.`
    );
  }

  // On Vercel the filesystem is read-only, so a silent fallback would only
  // produce confusing ENOENT errors later. Fail loudly, naming the gap.
  const missing = Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (process.env.VERCEL && missing.length > 0) {
    throw new Error(
      `R2 storage is not configured: missing env var(s) ${missing.join(", ")}. ` +
        `Set them in Vercel (Settings > Environment Variables, enabled for Production) and redeploy.`
    );
  }

  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
    active = new R2BlobStore({
      accountId: R2_ACCOUNT_ID.trim(),
      accessKeyId: R2_ACCESS_KEY_ID.trim(),
      secretAccessKey: R2_SECRET_ACCESS_KEY.trim(),
      bucket: R2_BUCKET.trim(),
    });
  } else {
    active = new FsBlobStore();
  }
  return active;
}

/** Test hook. */
export function setBlobStore(store: BlobStore | null): void {
  active = store;
}
