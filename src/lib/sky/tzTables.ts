/**
 * The IANA time zone tables Retrospect reads, parsed (spec 7.5): each zone's
 * principal city from `zone1970.tab`, and the old and merged names from
 * `backward`. Pure functions of the files' text, with no imports, so
 * `scripts/zone-cities.mjs` can run them directly (Node 23.6 or later).
 *
 * The files are committed at `src/data/tz/`, from tzdata 2026b
 * (github.com/eggert/tz at tag 2026b). Both are in the public domain.
 */

/** ISO 6709 as zone1970.tab writes it, ±DDMM±DDDMM or ±DDMMSS±DDDMMSS, as
    degrees north and east, to 4 decimals: "+415100-0873900" is Chicago,
    41.85 and -87.65. */
export function parseCoordinates(iso6709: string): [number, number] {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(iso6709);
  if (!m) throw new Error(`Not ISO 6709 coordinates: ${iso6709}`);
  const part = (sign: string, d: string, mm: string, ss: string | undefined) => {
    const v = Number(d) + Number(mm) / 60 + Number(ss ?? 0) / 3600;
    return Math.round((sign === "-" ? -v : v) * 1e4) / 1e4;
  };
  return [part(m[1], m[2], m[3], m[4]), part(m[5], m[6], m[7], m[8])];
}

/** zone1970.tab's zones, each with its principal city: { "America/Chicago": [41.85, -87.65] }. */
export function parseZoneTab(text: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const [, coordinates, zone] = line.split("\t");
    out[zone] = parseCoordinates(coordinates);
  }
  return out;
}

/** backward's links, each old name to the zone it names now: { "Asia/Calcutta": "Asia/Kolkata" }. */
export function parseLinks(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const [kind, target, name] = line.replace(/#.*/, "").trim().split(/\s+/);
    if (kind === "Link" && target && name) out[name] = target;
  }
  return out;
}
