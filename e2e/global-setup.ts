import { existsSync, readFileSync, rmSync } from "node:fs";
import { FsBlobStore, getBlobStore, MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { SAMPLE_USERNAME, SAMPLE_ZONE, writeSampleListener } from "../scripts/sample-listener";
import { BASE_URL, BLOCKED_LOG, DATA_DIR } from "../playwright.config";

/**
 * Seeds the browser checks' store: a fresh folder (`e2e/.data`) holding only
 * the landing's made-up sample listener, its tags and NASA's data for it
 * (`writeSampleListener`), NASA's log stamped as read now so the server never
 * asks NASA for it. Then asks the server for the listener's answers, songs
 * and highlights until they're computed, so every check meets a ready page.
 * Last, it proves the server can't reach the network (`offline.mjs`): a
 * picture of the day the sample doesn't hold makes it try NASA, and that try
 * must be refused and logged as the log's one line. `global-teardown.ts`
 * then requires the log to hold nothing else for the whole run.
 */
export default async function globalSetup() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  const folder = new FsBlobStore(DATA_DIR);
  setBlobStore(folder);
  try {
    if (getBlobStore() !== folder) throw new Error("The browser checks may only seed their own folder");
    await writeSampleListener(SAMPLE_USERNAME, new Date());
  } finally {
    // An empty memory store, never `null`, which would hand anything still
    // running the environment's store.
    setBlobStore(new MemoryBlobStore());
  }

  const deadline = Date.now() + 120_000;
  for (const route of ["answers", "songs", "highlights"]) {
    for (;;) {
      const res = await fetch(`${BASE_URL}/api/user/${SAMPLE_USERNAME}/${route}?tz=${encodeURIComponent(SAMPLE_ZONE)}`, {
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json()) as { status?: string };
      if (res.ok && body.status !== "computing") break;
      if (!res.ok) throw new Error(`The seeded ${route} answered ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      if (Date.now() > deadline) throw new Error(`The seeded ${route} were still computing after 2 minutes`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const blocked = () => (existsSync(BLOCKED_LOG) ? readFileSync(BLOCKED_LOG, "utf8").trim().split("\n").filter(Boolean) : []);
  if (blocked().length > 0) throw new Error(`Starting and seeding the checks reached for the network:\n${blocked().join("\n")}`);
  await fetch(`${BASE_URL}/api/apod?date=2020-01-01`, { signal: AbortSignal.timeout(30_000) });
  const after = blocked();
  if (after.length !== 1 || !CONTROL.test(after[0])) {
    throw new Error(`The server's network block isn't in force (e2e/offline.mjs): a request for NASA's picture of the day logged ${JSON.stringify(after)}`);
  }
}

/** The one refused request setup makes on purpose; `global-teardown.ts` allows it and nothing else. */
export const CONTROL = /nasa\.gov/;
