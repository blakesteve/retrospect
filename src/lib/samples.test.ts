import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  afterMidnightOn,
  ARTISTS,
  CATALOG,
  generateSamples,
  NIGHTS,
  playsOn,
  SAMPLE_NOW,
  SAMPLE_USERNAME,
  SAMPLE_ZONE,
  sampleHistory,
} from "../../scripts/sample-listener";
import { openSheet, sheetDepth } from "@/components/listener/sheetUrl";
import space from "../../scripts/sample-space.json";
import { dropSample, openSample, SAMPLE_LABEL, SAMPLE_USER, SAMPLE_ZONE as LANDING_ZONE, sampleFile } from "@/components/landing/sampleUrls";
import { tileFacts } from "@/components/landing/tileFacts";

/*
 * The landing's sample listener (spec 8.1): the committed files under
 * `public/samples/` are what the real routes answer for a made-up history.
 *
 * To regenerate them, after anything the routes say changes:
 *
 *     WRITE_SAMPLES=1 npx vitest run src/lib/samples.test.ts
 *
 * Without it, the files are regenerated in memory and compared, so a sample
 * whose words no longer follow the real rule fails here.
 */

/* The routes' `after()` runs its job at once; NASA's refresh is a stand-in. */
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (job: () => Promise<unknown>) => void job() };
});
vi.mock("@/lib/space/work", () => ({
  runSpaceWork: vi.fn(async () => ({ skipped: false, ms: 0, fetches: 0, wrote: [], failed: [], done: true })),
}));

const DIR = path.resolve(__dirname, "../../public/samples");
const WRITE = process.env.WRITE_SAMPLES === "1";
let generated: Map<string, string>;

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no network for the sample");
    }),
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SAMPLE_NOW));
  try {
    generated = await generateSamples();
  } finally {
    vi.useRealTimers();
  }
  if (WRITE) {
    mkdirSync(DIR, { recursive: true });
    for (const f of readdirSync(DIR)) if (f.endsWith(".json") && !generated.has(f)) rmSync(path.join(DIR, f));
    for (const [name, text] of generated) writeFileSync(path.join(DIR, name), text);
  }
}, 120_000);
afterAll(() => vi.unstubAllGlobals());

const committed = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const json = <T = Record<string, unknown>>(name: string): T => JSON.parse(committed(name)) as T;
const committedNames = () => readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();

interface Song {
  songId: string;
  artist: string;
  track: string;
  plays: number;
  firstNight: string;
  firstPlayTime: string;
  firstPlayDate: string;
  highlight: string | null;
  early: boolean;
}
interface NightOut {
  date: string;
  plays: number;
  afterMidnight: number;
  eclipse: { kind: string } | null;
  firstPlays: { songId: string; artist: string; track: string; pairing: string | null }[];
  wild: { title: string } | null;
  space: {
    kp: number | null;
    xFlare: boolean | string | null;
    biggestFlare: string | null;
    epic: { url: string; credit: string } | "none" | "unknown";
    photos: { kind?: string; caption?: string }[];
    asteroid: { name: string } | null;
  };
}
const songsFile = () => json<{ row: Song[]; listed: Song[] }>("songs.json");
const night = (date: string) => json<{ nights: NightOut[] }>(`nights-${date.slice(0, 7)}.json`).nights.find((n) => n.date === date);

/** Every string anywhere in a JSON value, and every key. */
function walk(v: unknown, strings: string[] = [], keys: string[] = []): { strings: string[]; keys: string[] } {
  if (typeof v === "string") strings.push(v);
  else if (Array.isArray(v)) for (const x of v) walk(x, strings, keys);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      keys.push(k);
      walk(x, strings, keys);
    }
  return { strings, keys };
}

describe("the committed sample", () => {
  it("is exactly what the real routes say today", () => {
    expect([...generated.keys()].sort()).toEqual(committedNames());
    const stale = [...generated].filter(([name, text]) => committed(name) !== text).map(([name]) => name);
    expect(stale, "public/samples is stale: run WRITE_SAMPLES=1 npx vitest run src/lib/samples.test.ts").toEqual([]);
  });

  it("carries no digits that depend on the Node version (CI runs Node 22)", () => {
    // Trigonometry and powers differ in their last digits between Node
    // versions and platforms, so a value computed with them and written in
    // full makes the committed files stale on CI. These are the ones the
    // routes write; plain + - * / (a share, a p-value) is the same everywhere.
    const LIMITS: Record<string, number> = { phaseAngle: 2, illumination: 2, meters: 6 };
    const seen: Record<string, number> = { phaseAngle: 0, illumination: 0, meters: 0 };
    const long: string[] = [];
    const scan = (v: unknown, where: string) => {
      if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${where}[${i}]`));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          if (k in LIMITS && typeof x === "number") {
            seen[k]++;
            if ((String(x).split(".")[1] ?? "").length > LIMITS[k]) long.push(`${where}.${k}: ${x}`);
          } else scan(x, `${where}.${k}`);
        }
    };
    for (const f of committedNames()) scan(json(f), f);
    // Reach: the Moon on every night, and sizes in the nights and songs.
    expect(seen.phaseAngle).toBeGreaterThan(200);
    expect(seen.illumination).toBeGreaterThan(200);
    expect(seen.meters).toBeGreaterThan(200);
    expect(long.slice(0, 5)).toEqual([]);
  });

  it("is generated the same way every time", () => {
    const a = sampleHistory();
    const b = sampleHistory();
    expect(a).toEqual(b);
  });

  it("stays small, since a sheet fetches it on demand", () => {
    const sizes = committedNames().map((f) => committed(f).length);
    // 2 Oct 2026: 375,998 characters once the nights carried NASA's photos
    // and JPL's asteroids (300,397 at 29597fc). One sheet fetches one file.
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(400_000);
    expect(Math.max(...sizes)).toBeLessThan(80_000);
  });
});

describe("the sample is a made-up listener (8.1: never a real person's listening)", () => {
  it("is named sample, here and on the landing", () => {
    expect(SAMPLE_USERNAME).toBe("sample");
    expect(SAMPLE_USER).toBe("sample");
    expect(SAMPLE_ZONE).toBe("America/Chicago");
    expect(LANDING_ZONE).toBe("America/Chicago");
  });

  it("is round 2's listener: 44,088 plays over 1,096 nights from Sept 28, 2023", () => {
    const history = sampleHistory();
    expect(history).toHaveLength(44_088);
    expect(NIGHTS).toBe(1_096);
    // The first scrobble, 6:44 p.m. CDT on Sept 28, 2023 (round 2's).
    expect(history[0].uts).toBe(Date.parse("2023-09-28T23:44:00Z") / 1000);
    // Round 2's nights, read back: Sept 28, 2023 and the last.
    expect([playsOn(0), afterMidnightOn(0)]).toEqual([31, 2]);
    expect(playsOn(NIGHTS - 1)).toBe(28);
    // Every play is by an artist the generator names: nothing came from a store.
    expect(new Set(history.map((p) => p.artist)).size).toBeGreaterThan(30);
    for (const p of history) expect(ARTISTS[p.artist], p.artist).toBeDefined();
  });

  it("names only the songs it was given, and no listener", () => {
    const catalog = new Set(CATALOG.map((s) => `${s.artist}|${s.track}`));
    const { row, listed } = songsFile();
    const named = [...row, ...listed].map((s) => `${s.artist}|${s.track}`);
    for (const m of committedNames().filter((f) => f.startsWith("nights-")))
      for (const n of json<{ nights: NightOut[] }>(m).nights) named.push(...n.firstPlays.map((f) => `${f.artist}|${f.track}`));
    // Reach: the row, the 50 listed, and the nights' first plays were all read.
    expect(named.length).toBeGreaterThan(100);
    expect(named.filter((s) => !catalog.has(s))).toEqual([]);
    // No file carries a listener's name: no name field, and no listener's page.
    // The one name allowed is an asteroid's, JPL's designation ("2023 RF").
    const asteroids: string[] = [];
    for (const f of committedNames()) {
      const parsed = JSON.parse(committed(f), (k, v) => {
        if (k !== "asteroid" || !v || typeof v !== "object") return v;
        asteroids.push(v.name);
        const rest = { ...v };
        delete rest.name;
        return rest;
      });
      const { strings, keys } = walk(parsed);
      expect(keys.filter((k) => /^(user(name)?|listener|name)$/i.test(k)), f).toEqual([]);
      expect(strings.filter((s) => /\/u\//.test(s)), f).toEqual([]);
    }
    expect(asteroids.length).toBeGreaterThan(100);
    expect(asteroids.filter((a) => !/^\(?\d+/.test(a))).toEqual([]);
  });
});

describe("the sample opens what the landing promises (8.1)", () => {
  it("has the Aquarius sky: Apr 8, 2024, 1:38 p.m. CDT, the total solar eclipse", () => {
    const lead = songsFile().listed.find((s) => s.track === "Aquarius")!;
    expect(lead).toMatchObject({
      artist: "Boards of Canada",
      plays: 160,
      firstNight: "2024-04-08",
      firstPlayTime: "1:38 p.m. CDT",
      firstPlayDate: "Apr 8, 2024",
      highlight: "Total solar eclipse",
      early: false,
    });
  });

  it("has the night of May 10, 2024: 39 plays, the G5 storm, Good Luck, Babe!", () => {
    const may10 = night("2024-05-10")!;
    expect(may10).toMatchObject({ plays: 39, afterMidnight: 4, wild: { title: "The strongest geomagnetic storm in about 20 years" } });
    expect(may10.space).toMatchObject({ kp: 9, biggestFlare: "X5.8" });
    // Spec 2's own example sentence, word for word.
    expect(may10.firstPlays.map((f) => f.pairing)).toContain(
      "You first played Good Luck, Babe! at 10:22 p.m. CDT on May 10, 2024, during the strongest geomagnetic storm in about 20 years.",
    );
  });

  it("has the hero's night of Apr 8, 2024, the eclipse", () => {
    const apr8 = night("2024-04-08")!;
    expect(apr8).toMatchObject({ plays: 28, afterMidnight: 2, eclipse: { kind: "total solar" } });
    expect(apr8.wild?.title).toBe("A total solar eclipse across North America");
    expect(apr8.firstPlays.map((f) => f.track)).toContain("Aquarius");
  });

  it("shows NASA's photos on its nights, from the committed NASA months", () => {
    // The eclipse night's Earth, facing Chicago, from EPIC's own archive.
    const apr8 = night("2024-04-08")!.space.epic;
    expect(apr8).toMatchObject({ credit: "NASA EPIC team" });
    expect(typeof apr8 === "object" && apr8.url).toMatch(/^https:\/\/epic\.gsfc\.nasa\.gov\/archive\/natural\/2024\/04\/08\/jpg\/epic_1b_20240408\d{6}\.jpg$/);
    // Every month the samples show has NASA's data: a sample regenerated
    // into a new month fails here until `node scripts/sample-space.mjs` runs.
    const epicMonths = new Set(space.months.filter((m) => m.source === "epic").map((m) => m.month));
    const shown = new Set(committedNames().flatMap((f) => (f.startsWith("nights-") ? [f.slice(7, 14)] : [])));
    for (const w of json<{ wild: { date: string }[] }>("highlights.json").wild) shown.add(w.date.slice(0, 7));
    expect([...shown].filter((m) => !epicMonths.has(m))).toEqual([]);
    // Most nights have Earth, never "unknown"; storm and flare nights have the Sun.
    const nights = committedNames()
      .filter((f) => f.startsWith("nights-"))
      .flatMap((f) => json<{ nights: NightOut[] }>(f).nights);
    expect(nights.filter((n) => typeof n.space.epic === "object").length).toBeGreaterThan(nights.length * 0.8);
    expect(nights.filter((n) => n.space.epic === "unknown")).toEqual([]);
    expect(nights.filter((n) => n.space.photos.some((p) => p.kind === "sdo")).length).toBeGreaterThan(20);
    expect(json<{ counts: { flybys: number } }>("highlights.json").counts.flybys).toBeGreaterThan(1000);
    // Each storm night shows its own Sun, a picture per event moment (architect, 2 Oct 2026):
    // May 10's is the X5.8, filed under May 11 UTC; May 11's the X1.5 at 11:44 UTC.
    const sun = (date: string) => night(date)!.space.photos.find((p) => p.kind === "sdo")?.caption;
    expect(sun("2024-05-10")).toBe("The Sun at 8:26 p.m. CDT on May 10, 2024, from NASA's Solar Dynamics Observatory.");
    expect(sun("2024-05-11")).toBe("The Sun at 6:46 a.m. CDT on May 11, 2024, from NASA's Solar Dynamics Observatory.");
    const stormy = nights.filter((n) => n.space.kp !== null || n.space.xFlare);
    expect(stormy.length).toBeGreaterThan(20);
    expect(stormy.filter((n) => !n.space.photos.some((p) => p.kind === "sdo")).map((n) => n.date)).toEqual([]);
  });

  it("has every selected song's night, so a song sheet always finds it", () => {
    const { row, listed } = songsFile();
    expect(listed).toHaveLength(50);
    for (const s of [...row, ...listed]) expect(existsSync(path.join(DIR, `nights-${s.firstNight.slice(0, 7)}.json`)), s.track).toBe(true);
    for (const s of listed) expect(night(s.firstNight)!.firstPlays.map((f) => f.songId), s.track).toContain(s.songId);
  });

  it("answers all 12 questions, in the sample's zone, with the sync the planet sheet reads", () => {
    const answers = json<{ status: string; zone: string; questions: { number: number }[] }>("answers.json");
    expect(answers.status).toBe("ready");
    expect(answers.zone).toBe("America/Chicago");
    expect(answers.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const status = json<{ status: string; oldestUts: number; newestUts: number; totalScrobbles: number }>("status.json");
    expect(status).toMatchObject({ status: "ready", totalScrobbles: 44_088, oldestUts: Date.parse("2023-09-28T23:44:00Z") / 1000 });
    expect(status.newestUts).toBeGreaterThan(Date.parse("2026-09-27T09:00:00Z") / 1000);
  });

  it("says nothing that depends on when it's read", () => {
    const answers = json<{ headsUp: unknown; questions: { phrases: Record<string, unknown> }[] }>("answers.json");
    expect(answers.headsUp).toBeNull();
    const { strings } = walk(answers);
    expect(strings.length).toBeGreaterThan(100);
    expect(strings.filter((s) => /\b(next one|today|tomorrow|tonight|begins|turns retrograde|this (week|month))\b/i.test(s))).toEqual([]);
  });

  it("keeps the never-write list (9.6)", () => {
    const NEVER = [
      /\binnocent\b/i, /\bguilty\b/i, /\bconvict(ed|ion)\b/i, /\bsuspect\b/i, /\balleged(ly)?\b/i, /\bdebunk/i,
      /no horoscope required/i, /not vibes/i, /\bvibes?\b/i, /\bperegrine\b/i, /\bwandering\b/i, /\bsignificant/i,
      /\bstatistically\b/i, /\bindex\b/i, /p\s*</, /\d\.\d+×/, /\bproves?\b/i, /\bcannot\b/i, /\bbecause\b/i,
      /\bmade you\b/i, /\bcaused?\b/i, /\belectromagnetic/i, /\benergy\b/i, /\bvibrations?\b/i, /\bfrequenc(y|ies)\b/i,
      /\bdownloads?\b/i, /\bactivation\b/i, /\p{Extended_Pictographic}/u,
    ];
    const strings = committedNames().flatMap((f) => walk(json(f)).strings);
    // Reach: the sentences themselves are among what's scanned.
    expect(strings).toContain("Kp 9: a G5 storm, the top of the scale");
    const hits = strings.filter((s) => NEVER.some((re) => re.test(s)));
    expect(hits).toEqual([]);
  });
});

describe("the landing reads the sample", () => {
  it("maps each listener route to its committed file", () => {
    expect(sampleFile("answers")).toBe("/samples/answers.json");
    expect(sampleFile("songs")).toBe("/samples/songs.json");
    expect(sampleFile("nights", "&from=2024-05&to=2024-05")).toBe("/samples/nights-2024-05.json");
    // More than a month, or none: no such file, so the sheet's own failure shows.
    expect(sampleFile("nights", "&from=2024-04&to=2024-05")).toBe("/samples/nights-none.json");
    expect(existsSync(path.join(DIR, "nights-none.json"))).toBe(false);
    for (const route of ["answers", "songs", "highlights", "status", "genres"])
      expect(existsSync(path.join(DIR, sampleFile(route).replace("/samples/", ""))), route).toBe(true);
  });

  it("puts the sample's own facts on the tiles", () => {
    const facts = tileFacts();
    const lead = songsFile().listed.find((s) => s.track === "Aquarius")!;
    expect(facts.song).toEqual({ id: lead.songId, name: "Aquarius by Boards of Canada", chip: "Total solar eclipse", time: "1:38 p.m. CDT" });
    expect(facts.night).toEqual({ date: "2024-05-10", chip: "Solar storm, Kp 9" });
    expect(facts.words.reduce((n, w) => n + w.count, 0)).toBe(12);
  });

  it("labels every sample the way the spec words it", () => {
    expect(SAMPLE_LABEL).toBe("Sample · a made-up listener, the real sky");
  });

  it("stacks its own sheets in the history the listener's sheets use (4)", () => {
    const entries: { state: unknown; url: string }[] = [{ state: null, url: "/" }];
    let at = 0;
    const go = vi.fn();
    vi.stubGlobal("window", {
      location: {
        get href() {
          return `http://sample.local${entries[at].url}`;
        },
      },
      history: {
        get state() {
          return entries[at].state;
        },
        pushState(state: unknown, _: string, url: string) {
          entries.splice(at + 1, entries.length, { state, url });
          at++;
        },
        replaceState(state: unknown, _: string, url: string) {
          entries[at] = { state, url };
        },
        go,
      },
    });
    openSample("tonight");
    expect(entries[at].url).toBe("/?sample=tonight");
    // `sheetUrl.ts` reads the depth the landing wrote: back closes it.
    expect(sheetDepth()).toBe(1);
    // A question opened from the Tonight sample stacks above it.
    openSheet({ kind: "q", value: "storms" });
    expect(entries[at].url).toBe("/?sample=tonight&q=storms");
    expect(sheetDepth()).toBe(2);
    // A deep-linked sample closing drops its parameter in place.
    entries.splice(0, entries.length, { state: null, url: "/?sample=answers" });
    at = 0;
    dropSample();
    expect(entries).toEqual([{ state: { retrospectSheet: 0 }, url: "/" }]);
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("no network"))));
  });
});
