import { describe, expect, it } from "vitest";
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { nasaLogFrom } from "@/lib/space/compact";
import { synthCompact } from "@/lib/space/synthLog";
import { songIdOf } from "@/lib/listener/songs";
import { computeAnswers, type PairingFact } from "./engine";
import { answersPayload } from "./payload";

const at = (iso: string) => Date.parse(iso) / 1000;

/* Pairings (7.4): the listed songs first played while a question's condition
   held. Mercury was retrograde Apr 1, 2024 22:14 UTC to Apr 25 12:54 UTC. */
describe("pairings", () => {
  // A year of filler from Jan 2023, so April 2024 is past the first 90 days.
  const plays: Scrobble[] = [];
  for (let t = at("2023-01-01T20:00:00Z"); t < at("2024-12-31T00:00:00Z"); t += 86_400) plays.push({ uts: t, artist: "Filler", track: `day ${t}` });
  const song = (track: string, first: string, n = 6) =>
    Array.from({ length: n }, (_, i): Scrobble => ({ uts: at(first) + i * 86_400 * 3, artist: "Band", track }));
  plays.push(
    ...song("Under Mercury", "2024-04-10T20:00:00Z"),
    ...song("After Mercury", "2024-05-20T20:00:00Z"),
    ...song("Storm Song", "2024-05-11T01:00:00Z"), // 8 p.m. CDT, May 10: a storm night
    ...song("Flare Song", "2024-10-03T18:00:00Z"), // 1 p.m. CDT, Oct 3: the X9.0 peaked at 7:18 a.m.
    ...song("Already Loved", "2023-01-05T20:00:00Z", 30), // first 90 days: never news
  );
  plays.sort((a, b) => a.uts - b.uts);
  const id = (track: string) => songIdOf(`band ${track}`.toLowerCase());
  // May 10's storm reached Kp 9 at 10 p.m. CDT; the night's earlier 6.33 doesn't head it.
  const log = nasaLogFrom(
    synthCompact("2024-12-30T12:00:00Z", {
      kp: [["2024-05-10T21:00:00Z", 6.33], ["2024-05-11T03:00:00Z", 9]],
      xflares: [["2024-10-03T12:18:00Z", "X9.0"], ["2024-10-03T20:00:00Z", "X1.1"]],
    }),
  );
  const record = computeAnswers("pairing-test", plays, "America/Chicago", 0, log);
  const facts = (q: string) => record.questions.find((x) => x.id === q)!.pairings as PairingFact[];
  const pairings = (q: string) => facts(q).map((p) => p.songId);

  it("lists a song first played inside a condition's window, and not one outside it", () => {
    expect(pairings("mercury")).toContain(id("Under Mercury"));
    expect(pairings("mercury")).not.toContain(id("After Mercury"));
  });

  it("pairs questions 7 and 8 by the night NASA logged", () => {
    expect(pairings("storms")).toEqual([id("Storm Song")]);
    expect(pairings("flares")).toEqual([id("Flare Song")]);
  });

  it("keeps each first play's time, and the night's Kp or biggest flare, for the chip (8.7.3)", () => {
    expect(facts("mercury").find((p) => p.songId === id("Under Mercury"))).toEqual({ songId: id("Under Mercury"), at: at("2024-04-10T20:00:00Z") });
    expect(facts("storms")).toEqual([{ songId: id("Storm Song"), at: at("2024-05-11T01:00:00Z"), kp: 9 }]);
    expect(facts("flares")).toEqual([{ songId: id("Flare Song"), at: at("2024-10-03T18:00:00Z"), flare: "X9.0" }]);
    const chips = Object.fromEntries(
      answersPayload(record, "ready", at("2024-12-31T00:00:00Z") * 1000).questions.map((q) => [q.id, q.pairings]),
    );
    expect(chips.storms).toEqual([{ songId: id("Storm Song"), conditionText: "Kp 9 storm night" }]);
    expect(chips.flares).toEqual([{ songId: id("Flare Song"), conditionText: "X9.0 flare night" }]);
    expect(chips.mercury).toContainEqual({ songId: id("Under Mercury"), conditionText: "Mercury retrograde" });
  });

  it("never pairs a song from the first 90 days", () => {
    for (const q of record.questions) expect(pairings(q.id)).not.toContain(id("Already Loved"));
    // Reach: the scan reads song ids, and this history has some.
    expect(record.questions.flatMap((q) => pairings(q.id)).length).toBeGreaterThan(2);
  });

  it("never pairs one even when the 90-day rule is dropped and it's listed", () => {
    // One late song: under 3 qualify, so early songs are listed (7.5). "Early
    // Mercury" was first played inside the retrograde of Dec 29, 2022 to
    // Jan 18, 2023, in the history's first days.
    const young = [
      ...song("Early Mercury", "2023-01-05T20:00:00Z", 9),
      ...song("Late One", "2023-06-01T20:00:00Z"),
    ].sort((a, b) => a.uts - b.uts);
    const rec = computeAnswers("pairing-early", young, "America/Chicago", 0, null);
    const mercury = rec.questions.find((q) => q.id === "mercury")!.pairings as PairingFact[];
    expect(mercury.map((p) => p.songId)).not.toContain(id("Early Mercury"));
  });
});
