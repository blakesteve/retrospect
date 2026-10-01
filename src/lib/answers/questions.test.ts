import { describe, expect, it } from "vitest";
import { QUESTIONS, questionById } from "./questions";

/* The 12 as spec 5 has them since 1 Oct 2026 (Blake, the folklore
   proposal): literals, so a changed word is a decision, not a drift. */
describe("the 12 questions (spec 5)", () => {
  it("measure question 5 by old favorites after a year, and question 6 by how much you listen", () => {
    expect(questionById("moonstrong")).toMatchObject({
      number: 5,
      question: "When the Moon is strong, does it change how often you go back to old favorites?",
      measure: "oldfavorites",
      warmupDays: 365,
    });
    expect(questionById("venusmars")).toMatchObject({
      number: 6,
      question: "When Venus and Mars get along, do you listen more, or less?",
      measure: "listening",
      warmupDays: 0,
    });
    // Question 9 is unchanged: Mars in water stays after-midnight plays.
    expect(questionById("marswater")).toMatchObject({ measure: "aftermidnight", warmupDays: 0 });
  });

  it("need no warm-up for 8 of the 12", () => {
    expect(QUESTIONS.filter((q) => q.warmupDays === 0).map((q) => q.number)).toEqual([2, 4, 6, 7, 8, 9, 10, 12]);
  });

  it("tell spec 5's stories, word for word", () => {
    expect(QUESTIONS.map((q) => q.story)).toEqual([
      "The famous one: in the lore, messages go astray, and old friends, exes and unfinished business come back around.",
      "Opposite the Sun, the full Moon is said to bring things to a head, and folklore says nobody sleeps.",
      "A new moon is for beginnings: new starts, new sounds.",
      "Venus rules pleasure, and at home in Taurus or Libra she works with ease: comfort in one, beauty and company in the other.",
      "The Moon rules moods, memory and home. Dignified in Cancer or Taurus, she's said to be content and steady.",
      "Venus is what you love, and Mars is how you go after it. In a trine or sextile, the two are said to pull together.",
      "When the solar wind hits hard, auroras spread far from the poles, and folklore says people feel wired, restless and slow to sleep.",
      "X-class flares are the Sun at its loudest, and the lore says they turn up whatever you're already feeling.",
      "In Cancer, Scorpio or Pisces, Mars is said to turn inward: he broods, plans in silence, and slowly comes to a boil.",
      "Opposite her homes, Venus works harder for what she wants: bold in Aries, intense in Scorpio. The lore is clear it isn't bad luck.",
      "About every 19 months, Venus turns back for six weeks, and the lore says old loves come back around, and their songs with them.",
      "About every two years, Mars turns back for two or three months, and the lore says drive stalls and momentum slips.",
    ]);
  });
});
