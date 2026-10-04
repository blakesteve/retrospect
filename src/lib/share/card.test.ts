import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/lib/answers/questions";
import { cardFromPage, cardImage, cardRef, cardValue, firstPerson, nightSays, questionSays, shareLink, songSays } from "./card";

/* What a share card says and where it points (spec 8.7.5), word for word. */

describe("which card a value names", () => {
  it("reads a song, a night and a question", () => {
    expect(cardRef("song:abc_DEF-123")).toEqual({ kind: "song", id: "abc_DEF-123" });
    expect(cardRef("night:2024-05-10")).toEqual({ kind: "night", date: "2024-05-10" });
    expect(cardRef("q:fullmoon")).toEqual({ kind: "q", id: "fullmoon" });
  });
  it.each(["", "song:", "night:May10", "night:2024-5-10", "planet:venus", "q", "song:has space", null, undefined])("refuses %j", (v) => {
    expect(cardRef(v)).toBeNull();
  });
  it("writes the value back as it read it", () => {
    for (const v of ["song:abc", "night:2024-05-10", "q:storms"]) expect(cardValue(cardRef(v)!)).toBe(v);
  });
});

describe("what a card says, in plain words (8.7.5's three examples)", () => {
  it("a song's sky", () => {
    expect(songSays({ track: "Good Luck, Babe!", artist: "Chappell Roan", firstPlayTime: "10:22 p.m. CDT", firstPlayDate: "May 10, 2024" })).toBe(
      "The sky the minute I first played Good Luck, Babe! by Chappell Roan · 10:22 p.m. CDT, May 10, 2024",
    );
  });
  it("a night, with its wild title or without", () => {
    expect(nightSays("May 10, 2024", "The strongest geomagnetic storm in about 20 years")).toBe(
      "My night of May 10, 2024: the strongest geomagnetic storm in about 20 years",
    );
    expect(nightSays("Apr 2, 2024", null)).toBe("My night of Apr 2, 2024");
  });
  it("a question and its word, never the word alone", () => {
    expect(questionSays("Does a full moon change how late you listen?", "No")).toBe("Does a full moon change how late I listen? No.");
  });
  it("asks every one of the 12 in the first person, with no 'you' left over", () => {
    for (const q of QUESTIONS) expect(firstPerson(q.question), q.id).not.toMatch(/\byou(r)?\b/i);
    expect(firstPerson("When Venus is at home, do you listen more, or less?")).toBe("When Venus is at home, do I listen more, or less?");
    expect(firstPerson("When Venus is in detriment, does your listening change?")).toBe("When Venus is in detriment, does my listening change?");
  });
});

describe("where a card points", () => {
  it("shares the listener's page with the card's sheet, in the sharer's zone (7.1)", () => {
    expect(shareLink("https://r.example", "sample", { kind: "song", id: "abc" }, "America/Chicago")).toBe(
      "https://r.example/u/sample?song=abc&tz=America%2FChicago",
    );
    expect(shareLink("https://r.example", "sam ple", { kind: "night", date: "2024-05-10" }, "Asia/Tokyo")).toBe(
      "https://r.example/u/sam%20ple?night=2024-05-10&tz=Asia%2FTokyo",
    );
    expect(shareLink("https://r.example", "sample", { kind: "q", id: "fullmoon" }, "UTC")).toBe("https://r.example/u/sample?q=fullmoon&tz=UTC");
  });
  it("asks for the image at either size, or the generic card", () => {
    expect(cardImage("sample", { kind: "q", id: "storms" }, "America/Chicago")).toBe("/api/og?u=sample&card=q%3Astorms&tz=America%2FChicago");
    expect(cardImage("sample", { kind: "q", id: "storms" }, "America/Chicago", "tall")).toBe("/api/og?u=sample&card=q%3Astorms&tz=America%2FChicago&size=tall");
    expect(cardImage("sample", null, "UTC")).toBe("/api/og?u=sample&tz=UTC");
  });
  it("unfurls a page by the sheet its link carries", () => {
    expect(cardFromPage({ song: "abc", tz: "UTC" })).toEqual({ kind: "song", id: "abc" });
    expect(cardFromPage({ night: "2024-05-10" })).toEqual({ kind: "night", date: "2024-05-10" });
    expect(cardFromPage({ q: "storms" })).toEqual({ kind: "q", id: "storms" });
    expect(cardFromPage({ planet: "venus" })).toBeNull();
    expect(cardFromPage({ song: ["a", "b"] })).toBeNull();
    expect(cardFromPage({})).toBeNull();
  });
});
