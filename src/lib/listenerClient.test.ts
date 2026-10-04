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
  // With the pure modules the browser imports for them (`src/lib/client`, `src/lib/motion`), tests aside.
  const files = [
    ...walk("src/components/listener"),
    ...walk("src/lib/client"),
    ...walk("src/lib/motion"),
    "src/components/Histogram.tsx",
    "src/components/Apod.tsx",
    "src/components/NoScrobbles.tsx",
    "src/components/SyncScreen.tsx",
  ].filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f));
  const sources = files.map((f) => ({ f, s: readFileSync(path.join(root, f), "utf8") }));

  it("reach every file they're about", () => {
    expect(files).toContain(path.join("src/components/listener/Tonight.tsx"));
    expect(files).toContain(path.join("src/components/listener/sheets/QuestionSheet.tsx"));
    expect(files).toContain(path.join("src/lib/client/forYou.ts"));
    expect(files).toContain(path.join("src/lib/motion/wheelPath.ts"));
    expect(files.length).toBeGreaterThan(15);
  });

  /**
   * A file's static imports, resolved: repo paths for `@/`, `./` and `../`,
   * a package by its name. `import ... from`, `export ... from` and a bare
   * `import "x"` all count; `import type`, `export type` and braces holding
   * only `type` names are erased and cost no client bytes; `import()` is a
   * lazy chunk and isn't followed.
   */
  const staticImports = (file: string, src: string): string[] => {
    const out: string[] = [];
    const re = /^\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
    for (const m of src.matchAll(re)) {
      if (m[3]) {
        out.push(m[3]);
        continue;
      }
      const clause = m[1].trim();
      if (/^type\b/.test(clause)) continue;
      const braces = clause.match(/^\{([^}]*)\}$/);
      if (braces && braces[1].split(",").map((x) => x.trim()).filter(Boolean).every((x) => /^type\s/.test(x))) continue;
      out.push(m[2]);
    }
    return out.map((spec) => {
      const base = spec.startsWith("@/") ? path.join("src", spec.slice(2)) : spec.startsWith(".") ? path.join(path.dirname(file), spec) : null;
      if (base === null) return spec;
      for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        try {
          if (readdirSync(path.dirname(path.join(root, c))).includes(path.basename(c)) && /\.tsx?$/.test(c)) return c;
        } catch {
          /* not a directory */
        }
      }
      return base;
    });
  };
  /** Every file and package a static import reaches from `starts`. */
  const reach = (starts: string[]) => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (/\.tsx?$/.test(f)) stack.push(...staticImports(f, readFileSync(path.join(root, f), "utf8")));
    }
    return seen;
  };

  // `@/lib/sky/sky` is banned here for Tonight and its sheets, which read
  // the sky from the routes. Spec 7.2 lets the Sky view import it (8.6),
  // through one module, `skyCompute.ts`, which the view loads after its
  // first paint (next test).
  const SKY_MODULE_DOOR = path.join("src/lib/client/skyCompute.ts");
  const banned = /^src\/lib\/(answers\/(payload|engine|conditions|nullTrials)|sky\/(windows|sky|tonight|planet|comingUp)|listener\/(?!words\.ts$)|space\/|likelihood|readiness|report|ephemeris|analysis)/;
  it("import nothing that reaches the sky data or the old analysis (13.5)", () => {
    const through = new Set<string>();
    for (const { f, s } of sources) {
      for (const m of staticImports(f, s)) {
        if (f === SKY_MODULE_DOOR && m === path.join("src/lib/sky/sky.ts")) {
          through.add(f);
          continue;
        }
        expect(m, `${f} imports ${m}`).not.toMatch(banned);
      }
    }
    // The one way in, and it's used.
    expect([...through]).toEqual([SKY_MODULE_DOOR]);
    // The controls: each form of import is caught, resolved; a type import isn't one.
    const from = path.join("src/lib/client/dial.ts");
    expect(staticImports(from, 'import { answersPayload } from "@/lib/answers/payload";')[0]).toMatch(banned);
    expect(staticImports(from, 'export { skyAt } from "@/lib/sky/sky";')).toEqual([path.join("src/lib/sky/sky.ts")]);
    expect(staticImports(from, 'export * from "../sky/sky";')).toEqual([path.join("src/lib/sky/sky.ts")]);
    expect(staticImports(from, 'import "@/lib/sky/sky";')).toEqual([path.join("src/lib/sky/sky.ts")]);
    expect(staticImports(from, 'import type { AnswersPayload } from "@/lib/answers/payload";')).toEqual([]);
    expect(staticImports(from, 'import { type SkyAt, type Sign } from "@/lib/sky/sky";')).toEqual([]);
    expect(staticImports(from, 'import { skyAt, type Sign } from "@/lib/sky/sky";')).toEqual([path.join("src/lib/sky/sky.ts")]);
  });

  it("load the sky module and the birth chart's math only after the Sky view's first paint (8.6, 13)", () => {
    // astronomy-engine is about 47 KB: no listener view's first load carries
    // it. A static walk from each view and the shell, following every static
    // import and no `import()`.
    const views = ["Shell.tsx", "Tonight.tsx", "EveryNight.tsx", "SkyView.tsx"].map((f) => path.join("src/components/listener", f));
    const reached = reach(views);
    expect(reached.has("astronomy-engine")).toBe(false);
    for (const lazy of ["src/lib/client/skyCompute.ts", "src/lib/astro/natal.ts", "src/lib/sky/sky.ts", "src/components/BirthChartPanel.tsx"]) {
      expect(reached.has(path.join(lazy)), lazy).toBe(false);
    }
    // Reach: the walk went deep (the dial's logic, the travel, the shell's sheets).
    for (const f of ["src/lib/client/dial.ts", "src/lib/motion/trips.ts", "src/components/listener/SheetHost.tsx", "src/lib/zone.ts"]) {
      expect(reached.has(path.join(f)), f).toBe(true);
    }
    // The view does load both, as calls (a type query isn't a load).
    const view = readFileSync(path.join(root, "src/components/listener/SkyView.tsx"), "utf8");
    expect(view).toMatch(/import\("@\/lib\/client\/skyCompute"\)\.then\(/);
    expect(view).toMatch(/import\("@\/lib\/astro\/natal"\)\.then\(/);
    // The controls: a relative static import is followed; a lazy one isn't.
    const from = path.join("src/lib/client/dial.ts");
    expect(staticImports(from, 'import { skyPath } from "./skyCompute";')).toEqual([path.join("src/lib/client/skyCompute.ts")]);
    expect(staticImports(from, 'const m = await import("./skyCompute");')).toEqual([]);
  });

  it("never name a question by its number alone (9.2, 2 Oct 2026)", () => {
    // "Question {n}: {short name}", "Question {n}, on {subject}", or the
    // sheet's own "Question {n} of 12"; anything else after the number is bare.
    const bare = /Question (?:\$\{[^}]+\}|\{[^}]+\})(?!:|,| of )/;
    let reached = 0;
    for (const { f, s } of sources) {
      for (const m of s.matchAll(/Question (?:\$\{[^}]+\}|\{[^}]+\})[^\n]{0,4}/g)) {
        reached++;
        expect(m[0], f).not.toMatch(bare);
      }
    }
    expect(reached).toBeGreaterThanOrEqual(6);
    // Controls: the pattern catches 3a's bare link and passes the named forms.
    expect("Question {meta.number}\n</SheetLink>").toMatch(bare);
    expect("Question ${held.number} has the answer").toMatch(bare);
    expect("Question {q.number}: {q.shortName}").not.toMatch(bare);
    expect("Question ${held.number}, on ${held.subject}").not.toMatch(bare);
    expect("Question ${question.number} of 12").not.toMatch(bare);
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
