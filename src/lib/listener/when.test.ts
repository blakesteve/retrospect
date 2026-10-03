import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tonightHeading } from "@/lib/sky/tonight";
import { happenedWhen, startsWhen } from "./when";

const at = (iso: string) => Date.parse(iso) / 1000;
const CHICAGO = "America/Chicago";
// Venus stations at 2:09 a.m. CDT on Saturday, Oct 3, 2026 (the spec's chip).
const STATION = at("2026-10-03T07:09:00Z");

describe("day words, counted from the heading's night (architect, 2 Oct 2026)", () => {
  it("keeps today as the night before between midnight and 4 a.m.", () => {
    // 1 a.m. Sunday, Oct 4: the heading says Saturday night.
    const sundayOne = at("2026-10-04T06:00:00Z");
    expect(tonightHeading(CHICAGO, sundayOne)).toBe("Saturday night, Oct 3");
    expect(happenedWhen(CHICAGO, sundayOne, STATION)).toBe("today"); // by the calendar, "yesterday"
    // 1 a.m. Friday, Oct 2: Thursday night, so Saturday is two days on.
    const fridayOne = at("2026-10-02T06:00:00Z");
    expect(tonightHeading(CHICAGO, fridayOne)).toBe("Thursday night, Oct 1");
    expect(startsWhen(CHICAGO, fridayOne, STATION)).toBe("Saturday"); // by the calendar, "tomorrow"
    expect(startsWhen(CHICAGO, fridayOne, at("2026-10-02T02:00:00Z") + 20 * 3600)).toBe("tomorrow"); // 9 p.m. Friday
  });

  it("calls the rest of the night today in the small hours, the station 69 minutes off included", () => {
    // 1 a.m. Saturday, Oct 3: the heading says Friday night, and the 2:09 a.m. station is tonight.
    const saturdayOne = at("2026-10-03T06:00:00Z");
    expect(tonightHeading(CHICAGO, saturdayOne)).toBe("Friday night, Oct 2");
    expect(startsWhen(CHICAGO, saturdayOne, STATION)).toBe("today");
    expect(startsWhen(CHICAGO, at("2026-10-03T07:08:00Z"), STATION)).toBe("today");
    expect(happenedWhen(CHICAGO, at("2026-10-03T07:10:00Z"), STATION)).toBe("today");
    // Saturday evening is the next night: tomorrow.
    expect(startsWhen(CHICAGO, saturdayOne, at("2026-10-04T01:00:00Z"))).toBe("tomorrow");
  });

  it("names the moment by its own calendar day, as the spec's chip does", () => {
    // 3 p.m. Friday: the 2:09 a.m. Saturday station is "tomorrow", not Friday night.
    expect(startsWhen(CHICAGO, at("2026-10-02T20:00:00Z"), STATION)).toBe("tomorrow");
    // 10 p.m. Saturday: it happened today.
    expect(happenedWhen(CHICAGO, at("2026-10-04T03:00:00Z"), STATION)).toBe("today");
    expect(startsWhen(CHICAGO, at("2026-09-20T17:00:00Z"), STATION)).toBe("Oct 3");
    expect(startsWhen(CHICAGO, at("2025-09-20T17:00:00Z"), STATION)).toBeNull();
    expect(startsWhen(CHICAGO, at("2025-12-20T17:00:00Z"), STATION)).toBe("Oct 3, 2026");
  });

  it("is the only copy in the app, so chips and heads-ups can't drift apart", () => {
    const src = path.resolve(__dirname, "../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(src);
    // Reach: the scan read the app, these words' callers included.
    expect(files.some((f) => f.endsWith(path.join("sky", "tonight.ts")))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("answers", "payload.ts")))).toBe(true);
    const defines = (name: string) =>
      files.filter((f) => new RegExp(`(function|const|let)\\s+${name}\\b`).test(readFileSync(f, "utf8"))).map((f) => path.relative(src, f));
    expect(defines("startsWhen")).toEqual([path.join("lib", "listener", "when.ts")]);
    expect(defines("happenedWhen")).toEqual([path.join("lib", "listener", "when.ts")]);
    // No other "tomorrow" or "yesterday" is written anywhere else, however it's built.
    const words = files.filter((f) => !f.endsWith(`${path.sep}when.ts`) && /["'`](tomorrow|yesterday)["'`]/i.test(readFileSync(f, "utf8")));
    expect(words.map((f) => path.relative(src, f))).toEqual([]);
    // And the chips and the heads-ups take theirs from here.
    for (const caller of [path.join("lib", "sky", "tonight.ts"), path.join("lib", "answers", "payload.ts")]) {
      expect(readFileSync(path.join(src, caller), "utf8"), caller).toMatch(/import \{[^}]*\bstartsWhen\b[^}]*\} from "@\/lib\/listener\/when";/);
    }
  });
});
