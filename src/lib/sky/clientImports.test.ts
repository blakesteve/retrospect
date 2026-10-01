import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* The generated sky is about a megabyte, and spec 7.2 says it's server only:
   each view gets its slice from an endpoint. This walks the real import graph
   from every client module ("use client" files, and everything they import)
   and fails if any reaches src/lib/sky/windows.ts or src/lib/sky/data/. The built
   chunks get the same check after `next build`
   (`scripts/check-sky-server-only.mjs`). */

const root = path.resolve(__dirname, "../../..");
const SOURCE_DIRS = ["src/app", "src/components", "src/lib"];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

/** Where an import specifier points, or null for a package. */
function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  // TypeScript lets an import say "./x.js" and mean "./x.ts".
  const bare = base.replace(/\.js$/, "");
  for (const candidate of [base, `${bare}.ts`, `${bare}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Runtime imports only: `import type` never reaches a bundle. */
function importsOf(file: string): string[] {
  if (file.endsWith(".json")) return [];
  const src = readFileSync(file, "utf8");
  const specs = [
    ...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm),
    ...src.matchAll(/^\s*export\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm),
    ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ...src.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
  /* Not followed: an import whose path is built at run time, like a template
     string. None exists in this app; the built-chunk scan would catch one. */
  return specs.map((s) => resolve(file, s)).filter((f): f is string => f !== null);
}

function reachable(starts: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...importsOf(f));
  }
  return seen;
}

const sources = SOURCE_DIRS.flatMap((d) => walk(path.join(root, d)));
/** "use client" before any code, with comments allowed above it, as Next allows. */
const startsUseClient = (src: string) =>
  /^["']use client["']/.test(src.replace(/^(?:\s+|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, ""));
const isClient = (f: string) => startsUseClient(readFileSync(f, "utf8"));
const clientRoots = sources.filter(isClient);
const rel = (f: string) => path.relative(root, f);
const isSkyData = (f: string) => f === "src/lib/sky/windows.ts" || f.startsWith("src/lib/sky/data/");

describe("client modules and the generated sky", () => {
  it("found the client modules to start from", () => {
    // Positive control: the walk has something to walk.
    expect(clientRoots.map(rel)).toContain("src/components/SkyCalendar.tsx");
  });

  it("follows JSON imports: today's calendar reaches today's small ephemeris files", () => {
    // Positive control: a graph walk that skipped JSON would pass the real
    // check below on nothing. This path is known to exist until phase 3.
    const fromCalendar = reachable([path.join(root, "src/components/SkyCalendar.tsx")]);
    expect([...fromCalendar].map(rel)).toContain("src/lib/ephemeris/mercury-retrogrades.json");
  });

  it("sees the loader's own imports of the data, and would call them leaks", () => {
    // Positive control for the check below: from the loader, the filter must fire.
    const fromLoader = [...reachable([path.join(root, "src/lib/sky/windows.ts")])].map(rel);
    expect(fromLoader).toContain("src/lib/sky/data/signs.json");
    expect(fromLoader.filter(isSkyData).length).toBe(6); // the loader and its five files
  });

  it("finds a client module even with a comment above \"use client\"", () => {
    expect(clientRoots.length).toBeGreaterThan(20);
    expect(startsUseClient('/* note */\n// more\n"use client";\nimport x from "y";')).toBe(true);
    expect(startsUseClient('import x from "y";\n"use client";')).toBe(false);
  });

  it("lets no client module reach the loader or the data", () => {
    const leaks = [...reachable(clientRoots)].map(rel).filter(isSkyData);
    expect(leaks).toEqual([]);
  });

  it("keeps the shared sky module free of data, so the Sky view can import it", () => {
    const fromModule = [...reachable([path.join(root, "src/lib/sky/sky.ts")])].map(rel);
    expect(fromModule.filter((f) => f.endsWith(".json"))).toEqual([]);
  });
});
