import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Every tuning knob in this app is read from the environment with a fallback.
 * Those fallbacks used `??`, which fires on null and undefined but not on an
 * empty string, so a variable that is present and blank sails straight through.
 * For the numbers that matters twice over, because `Number("")` is 0, not NaN:
 * nothing throws, nothing warns, the app just runs with every budget at zero.
 *
 * **These tests have to stub and re-import to mean anything.** Under Vitest the
 * variables are absent, and `undefined ?? 8000` and `undefined?.trim() || 8000`
 * are the same 8000. Reading a resolved constant proves nothing about which
 * operator produced it. Only a stubbed empty string separates them, and only
 * after `vi.resetModules()`, since these are resolved once at module load.
 */

const FRESH_SYNC = () => import("./sync");
const FRESH_TAGSYNC = () => import("./tagsync");

async function withEnv<T>(vars: Record<string, string>, load: () => Promise<T>): Promise<T> {
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.resetModules();
  return load();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sync tuning constants", () => {
  it("uses its defaults when the variables are absent", async () => {
    vi.resetModules();
    const sync = await FRESH_SYNC();
    expect(sync.BUDGET_MS).toBe(8_000);
    expect(sync.PAGE_DELAY_MS).toBe(250);
    expect(sync.BATCH_PAGES).toBe(4);
    expect(sync.REFRESH_SECONDS).toBe(3600);
  });

  /**
   * The regression. A blank `SYNC_BUDGET_MS` gives `Number("")`, which is 0, and
   * `backfill` opens with `while (Date.now() < deadline)` against a deadline
   * that has already passed. Not one page is ever fetched, the state never
   * leaves "syncing", and the client polls a worker that can not finish.
   */
  it("falls back when a variable is present but empty", async () => {
    const sync = await withEnv(
      {
        SYNC_BUDGET_MS: "",
        SYNC_PAGE_DELAY_MS: "",
        SYNC_BATCH_PAGES: "",
        SYNC_REFRESH_SECONDS: "",
      },
      FRESH_SYNC,
    );
    expect(sync.BUDGET_MS).toBe(8_000);
    expect(sync.PAGE_DELAY_MS).toBe(250);
    expect(sync.BATCH_PAGES).toBe(4);
    expect(sync.REFRESH_SECONDS).toBe(3600);
  });

  it("falls back when a variable is only whitespace", async () => {
    // `Number(" ")` is also 0, so trimming is part of the guard, not a nicety.
    const sync = await withEnv({ SYNC_BUDGET_MS: "   " }, FRESH_SYNC);
    expect(sync.BUDGET_MS).toBe(8_000);
  });

  it("never resolves a budget to zero, whatever the blank looks like", async () => {
    for (const blank of ["", " ", "\t", "\n"]) {
      const sync = await withEnv({ SYNC_BUDGET_MS: blank, TAGSYNC_BUDGET_MS: blank }, FRESH_SYNC);
      expect(sync.BUDGET_MS, JSON.stringify(blank)).toBeGreaterThan(0);
    }
  });

  it("honors a real configured value", async () => {
    const sync = await withEnv(
      { SYNC_BUDGET_MS: "1200", SYNC_BATCH_PAGES: "9" },
      FRESH_SYNC,
    );
    expect(sync.BUDGET_MS).toBe(1200);
    expect(sync.BATCH_PAGES).toBe(9);
  });

  /**
   * The guard sits on the string, not on the resolved number, so an explicit
   * zero still means zero. `Number(x) || 250` would quietly refuse to let anyone
   * turn the politeness delay off.
   */
  it("keeps an explicitly configured zero", async () => {
    const sync = await withEnv({ SYNC_PAGE_DELAY_MS: "0" }, FRESH_SYNC);
    expect(sync.PAGE_DELAY_MS).toBe(0);
  });
});

describe("tag sync tuning constants", () => {
  it("uses its defaults when the variables are absent", async () => {
    vi.resetModules();
    const tagsync = await FRESH_TAGSYNC();
    expect(tagsync.BUDGET_MS).toBe(8_000);
    expect(tagsync.CALL_DELAY_MS).toBe(200);
  });

  it("falls back when a variable is present but empty", async () => {
    const tagsync = await withEnv(
      { TAGSYNC_BUDGET_MS: "", TAGSYNC_DELAY_MS: "" },
      FRESH_TAGSYNC,
    );
    expect(tagsync.BUDGET_MS).toBe(8_000);
    expect(tagsync.CALL_DELAY_MS).toBe(200);
  });

  it("keeps an explicitly configured zero delay", async () => {
    const tagsync = await withEnv({ TAGSYNC_DELAY_MS: "0" }, FRESH_TAGSYNC);
    expect(tagsync.CALL_DELAY_MS).toBe(0);
  });
});

describe("the local blob directory", () => {
  async function freshStore(dataDir?: string) {
    if (dataDir !== undefined) vi.stubEnv("DATA_DIR", dataDir);
    vi.resetModules();
    const { FsBlobStore } = await import("./store/blob");
    return new FsBlobStore();
  }

  it("defaults to .data when DATA_DIR is absent", async () => {
    expect((await freshStore()).dir).toBe(".data");
  });

  /**
   * An empty `DATA_DIR` is not a synonym for the default. `path.join("", key)`
   * is just `key`, so every blob lands beside whatever the process happens to
   * be running in, and reads agree with writes about the wrong location.
   */
  it("falls back to .data when DATA_DIR is present but empty", async () => {
    expect((await freshStore("")).dir).toBe(".data");
    expect((await freshStore("   ")).dir).toBe(".data");
  });

  it("honors a real configured directory", async () => {
    expect((await freshStore("/tmp/retrospect-data")).dir).toBe("/tmp/retrospect-data");
  });
});

describe("metadataBase in the root layout", () => {
  /** `metadataBase` is typed `string | URL`, so compare it as a string. */
  async function freshBase(baseUrl?: string): Promise<string> {
    if (baseUrl !== undefined) vi.stubEnv("NEXT_PUBLIC_BASE_URL", baseUrl);
    vi.resetModules();
    const { metadata } = await import("@/app/layout");
    return String(metadata.metadataBase);
  }

  it("defaults to localhost when NEXT_PUBLIC_BASE_URL is absent", async () => {
    expect(await freshBase()).toBe("http://localhost:3000/");
  });

  /**
   * `new URL("")` throws a TypeError, and this runs at module scope in the root
   * layout, so a blank variable does not degrade one page: it takes down every
   * route in the app.
   */
  it("does not throw when NEXT_PUBLIC_BASE_URL is present but empty", async () => {
    await expect(freshBase("")).resolves.toBe("http://localhost:3000/");
    expect(await freshBase("  ")).toBe("http://localhost:3000/");
  });

  it("honors a real configured base URL", async () => {
    expect(await freshBase("https://retrospect.example.com")).toBe(
      "https://retrospect.example.com/",
    );
  });

  it("would throw, if an empty string ever reached the URL constructor", async () => {
    // States the runtime fact the guard exists for, so the reason survives even
    // if the guard moves.
    expect(() => new URL("")).toThrow(TypeError);
  });
});
