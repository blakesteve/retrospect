import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
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
}

/** Local-folder implementation: the default for `npm run dev`. */
export class FsBlobStore implements BlobStore {
  constructor(private dir = process.env.DATA_DIR ?? ".data") {}

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
}

/** In-memory implementation for tests. */
export class MemoryBlobStore implements BlobStore {
  private blobs = new Map<string, Buffer>();

  async get(key: string): Promise<Buffer | null> {
    return this.blobs.get(key) ?? null;
  }
  async put(key: string, data: Buffer): Promise<void> {
    this.blobs.set(key, Buffer.from(data));
  }
  async del(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}

let active: BlobStore | null = null;

/** Backend selection: R2 when its env vars are present, local folder otherwise. */
export function getBlobStore(): BlobStore {
  if (active) return active;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

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
