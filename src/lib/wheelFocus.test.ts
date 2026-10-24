import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Every wheel whose planets open something has Roster's keyboard-focus
   tracker mounted beside it (`KeyFocus`, components/listener/keyFocus.tsx),
   so its ring shows in Safari after a click (ClickUp 86e3rwyff). The wheel
   doesn't mount it itself, so the landing's picture wheels don't load it;
   a new tappable wheel would lose its rings in Safari with no browser check
   failing, so the callers are listed here by name. */

const root = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** Whether a file draws a `SkyWheel` whose planets open something. */
const tappableWheel = (source: string) => {
  for (let at = source.indexOf("<SkyWheel"); at >= 0; at = source.indexOf("<SkyWheel", at + 1)) {
    if (source.slice(at, source.indexOf("/>", at)).includes("onPlanet=")) return true;
  }
  return false;
};

describe("the wheels' keyboard-focus tracker", () => {
  const files = walk("src/components").filter((f) => f.endsWith(".tsx"));

  it("is mounted beside every wheel whose planets open something, and in the Sky view's", () => {
    const tappable = files.filter((f) => tappableWheel(readFileSync(path.join(root, f), "utf8")));
    expect(tappable.sort()).toEqual(
      ["src/components/landing/TonightSample.tsx", "src/components/listener/Tonight.tsx", "src/components/listener/sheets/SongSheet.tsx"].map((f) => path.join(f)),
    );
    for (const f of [...tappable, path.join("src/components/listener/SkyOrbits.tsx")]) expect(readFileSync(path.join(root, f), "utf8"), f).toContain("<KeyFocus />");
  });

  it("tells a tappable wheel from a picture", () => {
    expect(tappableWheel('<SkyWheel bodies={b} size={300} onPlanet={(body) => open(body)} />')).toBe(true);
    expect(tappableWheel("<SkyWheel bodies={b} size={140} />\n<Other onPlanet={x} />")).toBe(false);
  });
});
