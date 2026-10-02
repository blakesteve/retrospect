import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genreMix, isNightDate, nightTitle, tonightDate, utsAtLocal } from "@/components/listener/format";
import { closeSheets, finishClose, openSheet, sheetDepth, sheetFrom } from "@/components/listener/sheetUrl";

/* The redesign's client pieces that hold logic rather than layout (spec 4,
   7.1, 8.4): sheets as URLs, nights and their times, and what the listener
   components may import and say. */

describe("sheets are URLs (4)", () => {
  // A stand-in for the browser's history, enough for pushState and back.
  let entries: { state: unknown; url: string }[];
  let index: number;
  const popListeners: (() => void)[] = [];
  beforeEach(() => {
    entries = [{ state: null, url: "/u/sample?tz=America/Chicago" }];
    index = 0;
    const history = {
      get state() {
        return entries[index].state;
      },
      pushState(state: unknown, _: string, url: string) {
        entries = entries.slice(0, index + 1);
        entries.push({ state, url });
        index++;
      },
      replaceState(state: unknown, _: string, url: string) {
        entries[index] = { state, url };
      },
      go(n: number) {
        index += n;
        popListeners.forEach((l) => l());
      },
    };
    (globalThis as { window?: unknown }).window = {
      history,
      get location() {
        return new URL(entries[index].url, "http://x");
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });
  const url = () => entries[index].url;

  it("reads the first sheet parameter, in the spec's order", () => {
    expect(sheetFrom(new URLSearchParams("q=storms&song=abc"))).toEqual({ kind: "song", value: "abc" });
    expect(sheetFrom(new URLSearchParams("planet=venus"))).toEqual({ kind: "planet", value: "venus" });
    expect(sheetFrom(new URLSearchParams("tz=UTC"))).toBeNull();
  });

  it("pushes one entry per sheet, keeping the zone, and replaces the open one's parameter", () => {
    openSheet({ kind: "song", value: "abc" });
    expect(url()).toBe("/u/sample?tz=America%2FChicago&song=abc");
    expect(sheetDepth()).toBe(1);
    // A question from inside a song sky: one sheet at a time, back returns to the song.
    openSheet({ kind: "q", value: "storms" });
    expect(url()).toBe("/u/sample?tz=America%2FChicago&q=storms");
    expect(sheetDepth()).toBe(2);
    expect(entries).toHaveLength(3);
  });

  it("closes the whole stack the app opened by going back", () => {
    openSheet({ kind: "song", value: "abc" });
    openSheet({ kind: "q", value: "storms" });
    closeSheets();
    expect(index).toBe(0);
    expect(url()).toBe("/u/sample?tz=America/Chicago");
  });

  it("closes a deep-linked sheet by replacing the URL without it", () => {
    entries = [{ state: null, url: "/u/sample?night=2024-05-10" }];
    closeSheets();
    expect(entries).toHaveLength(1);
    expect(url()).toBe("/u/sample");
  });

  it("drops a deep link's parameter once a close has gone back onto it", () => {
    entries = [{ state: null, url: "/u/sample?night=2024-05-10" }];
    openSheet({ kind: "song", value: "abc" });
    closeSheets();
    expect(url()).toBe("/u/sample?night=2024-05-10");
    finishClose();
    expect(url()).toBe("/u/sample");
  });
});

describe("nights and their times (7.1)", () => {
  it("asks for 9 p.m. local on a night, daylight saving included", () => {
    // May 10, 2024, 9 p.m. CDT is 02:00 UTC the next day.
    expect(utsAtLocal("2024-05-10", 21, "America/Chicago")).toBe(Date.UTC(2024, 4, 11, 2) / 1000);
    // Jan 10, 2024, 9 p.m. CST is 03:00 UTC.
    expect(utsAtLocal("2024-01-10", 21, "America/Chicago")).toBe(Date.UTC(2024, 0, 11, 3) / 1000);
    expect(utsAtLocal("2024-05-10", 21, "Australia/Sydney")).toBe(Date.UTC(2024, 4, 10, 11) / 1000);
  });

  it("puts the hours before 4 a.m. on the night before", () => {
    // 3:59 a.m. CDT on Oct 2 belongs to Oct 1's night; 4:00 to Oct 2's.
    expect(tonightDate("America/Chicago", Date.UTC(2026, 9, 2, 8, 59))).toBe("2026-10-01");
    expect(tonightDate("America/Chicago", Date.UTC(2026, 9, 2, 9, 0))).toBe("2026-10-02");
  });

  it("refuses a date that isn't on the calendar", () => {
    expect(isNightDate("2024-05-10")).toBe(true);
    expect(isNightDate("2024-02-29")).toBe(true);
    expect(isNightDate("2019-02-30")).toBe(false);
    expect(isNightDate("2023-02-29")).toBe(false);
    expect(isNightDate("2024-5-10")).toBe(false);
  });

  it("names a night and its genre mix the way the spec writes them", () => {
    expect(nightTitle("2024-05-10")).toBe("Friday, May 10, 2024");
    expect(nightTitle("2024-09-03")).toBe("Tuesday, Sept 3, 2024");
    expect(genreMix([{ genre: "pop", plays: 9 }, { genre: "indie pop", plays: 5 }, { genre: "bedroom pop", plays: 3 }])).toBe(
      "Mostly pop, then indie pop and bedroom pop.",
    );
    expect(genreMix([{ genre: "shoegaze", plays: 4 }])).toBe("Mostly shoegaze.");
    expect(genreMix([])).toBeNull();
  });
});

describe("the listener components", () => {
  const root = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
  const files = [...walk("src/components/listener"), "src/components/Histogram.tsx", "src/components/Apod.tsx", "src/components/NoScrobbles.tsx", "src/components/SyncScreen.tsx"].filter((f) =>
    /\.tsx?$/.test(f),
  );
  const sources = files.map((f) => ({ f, s: readFileSync(path.join(root, f), "utf8") }));

  it("reach every file they're about", () => {
    expect(files).toContain(path.join("src/components/listener/Tonight.tsx"));
    expect(files).toContain(path.join("src/components/listener/sheets/QuestionSheet.tsx"));
    expect(files.length).toBeGreaterThan(15);
  });

  /** Runtime imports only: `import type` is erased and costs no client bytes. */
  const runtimeImports = (s: string) =>
    [...s.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);

  // `@/lib/sky/sky` is banned here for Tonight and its sheets, which read
  // the sky from the routes. Spec 7.2 lets the Sky view (3c) import it:
  // relax this for that view's files when it's built.
  it("import nothing that reaches the sky data or the old analysis (13.5)", () => {
    const banned = /^@\/lib\/(answers\/(payload|engine|conditions|nullTrials)|sky\/(windows|sky|tonight|planet|comingUp)|listener\/(?!words$)|space\/|likelihood|readiness|report|ephemeris|analysis)/;
    for (const { f, s } of sources) {
      for (const m of runtimeImports(s)) expect(m, `${f} imports ${m}`).not.toMatch(banned);
    }
    // The control: the pattern catches a runtime import of the payload module.
    expect(runtimeImports('import { answersPayload } from "@/lib/answers/payload";')[0]).toMatch(banned);
    expect(runtimeImports('import type { AnswersPayload } from "@/lib/answers/payload";')).toEqual([]);
  });

  it("never write what 9.6 forbids, in any string they show", () => {
    const strings = (s: string) =>
      [...s.matchAll(/"([^"\n]{3,})"|`([^`]{3,})`|>([^<>{}\n]{3,})</g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((t) => /[a-z]{3}/i.test(t));
    const NEVER =
      /\b(innocent|guilty|convicted|conviction|suspect|allegedly|debunk|peregrine|wandering|significant|statistically|proves|cannot|made you|caused|electromagnetic|energy|vibrations?|vibes|frequencies|downloads|activation)\b|no horoscope required|p</i;
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}](?!︎)/u;
    let reached = 0;
    for (const { f, s } of sources) {
      for (const t of strings(s)) {
        reached++;
        expect(t, `${f}: "${t}"`).not.toMatch(NEVER);
        expect(t, `${f}: "${t}"`).not.toMatch(EMOJI);
      }
    }
    expect(reached).toBeGreaterThan(150);
    // Controls: the patterns catch what they're for.
    expect("The full moon's energy is strong.").toMatch(NEVER);
    expect("Your sky is innocent.").toMatch(NEVER);
    expect("\u{1F319} Tonight").toMatch(EMOJI);
    expect("☽︎ Moon").not.toMatch(EMOJI);
  });
});
