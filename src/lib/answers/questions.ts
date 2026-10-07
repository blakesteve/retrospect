/**
 * The 12 questions (spec 5), fixed, in this order, for everyone. The number is
 * part of the copy ("Question 7") and never changes. The words each question
 * needs for its sentences come from spec 9.2.
 *
 * No data and no sky math here, so client code may import this module.
 */

export type QuestionId =
  | "mercury"
  | "fullmoon"
  | "newmoon"
  | "venushome"
  | "moonstrong"
  | "venusmars"
  | "storms"
  | "flares"
  | "marswater"
  | "venusdet"
  | "venusrx"
  | "marsrx";

/** What a question measures (spec 6.7). Three are shares of your plays; how
    much you listen is a rate, plays per day. */
export type Measure = "oldfavorites" | "aftermidnight" | "firstlistens" | "listening";

export interface Question {
  number: number;
  id: QuestionId;
  question: string;
  /** The folklore it tests, under the question, never in it. */
  story: string;
  /** For the 3-by-4 grid and the chips. */
  shortName: string;
  measure: Measure;
  /** Days at the start of a history this measure can't count. */
  warmupDays: number;
  /** Questions 7 and 8 test nights NASA logged. */
  nasa: boolean;
  /** Spec 9.2: "If {subject} moves you at all…". */
  subject: string;
  /** Whether the subject takes a plural verb ("solar storms move you"). */
  plural: boolean;
  /** Spec 9.2: "{When}, you listened 5% more." */
  when: string;
  eventNoun: { one: string; many: string };
  /** "How soon depends on how much you listen and how often {this}." */
  howOften: string;
  /**
   * Days its condition takes to come around again, for a question whose
   * windows repeat (6.1a). Each of its rotations turns on its own circle of
   * whole periods plus a seam, so the span's length can't decide which
   * rotations exist. Share measures only: a rate would count the circle's
   * stretch past the history as time spent not listening (`engine.ts`).
   * Absent: the windows turn on the span's own length (6.1).
   */
  period?: number;
}

/* The periods, as the sky has them: the synodic month (new moon to new
   moon), the tropical month (the Moon back in the same sign), and Mercury's
   synodic period (retrograde to retrograde). Which questions get one was
   measured, not assumed: each rotation's swing correlates with the swing one
   period later at 0.49 to 0.89 for these four and Venus retrograde, and at
   0.05 or less for every other question with a share measure (the median
   over made-up histories, 5 Oct 2026).
   Venus retrograde stays on 6.1's rule (6.1a): on whole periods it came out
   slightly too ready to say yes on no-effect data, and on the span's length
   its answer barely moves as a history grows. */
const SYNODIC_MONTH = 29.530589;
const TROPICAL_MONTH = 27.321582;
const MERCURY_SYNODIC = 115.8775;

export const QUESTIONS: readonly Question[] = [
  {
    number: 1,
    id: "mercury",
    question: "Does Mercury retrograde change how often you go back to old favorites?",
    story: "The famous one: in the lore, messages go astray, and old friends, exes and unfinished business come back around.",
    shortName: "Mercury retrograde",
    measure: "oldfavorites",
    period: MERCURY_SYNODIC,
    warmupDays: 365,
    nasa: false,
    subject: "Mercury retrograde",
    plural: false,
    when: "while Mercury was retrograde",
    eventNoun: { one: "retrograde", many: "retrogrades" },
    howOften: "Mercury turns retrograde",
  },
  {
    number: 2,
    id: "fullmoon",
    question: "Does a full moon change how late you listen?",
    story: "Opposite the Sun, the full Moon is said to bring things to a head, and folklore says nobody sleeps.",
    shortName: "Full moon",
    measure: "aftermidnight",
    period: SYNODIC_MONTH,
    warmupDays: 0,
    nasa: false,
    subject: "a full moon",
    plural: false,
    when: "around full moons",
    eventNoun: { one: "full moon", many: "full moons" },
    howOften: "the Moon is full",
  },
  {
    number: 3,
    id: "newmoon",
    question: "Does the new moon change how much new music you find?",
    story: "A new moon is for beginnings: new starts, new sounds.",
    shortName: "New moon",
    measure: "firstlistens",
    period: SYNODIC_MONTH,
    warmupDays: 365,
    nasa: false,
    subject: "the new moon",
    plural: false,
    when: "around new moons",
    eventNoun: { one: "new moon", many: "new moons" },
    howOften: "the Moon is new",
  },
  {
    number: 4,
    id: "venushome",
    question: "When Venus is at home, do you listen more, or less?",
    story: "Venus rules pleasure, and at home in Taurus or Libra she works with ease: comfort in one, beauty and company in the other.",
    shortName: "Venus at home",
    measure: "listening",
    warmupDays: 0,
    nasa: false,
    subject: "Venus at home",
    plural: false,
    when: "while Venus was at home",
    eventNoun: { one: "stretch", many: "stretches" },
    howOften: "Venus is at home",
  },
  {
    number: 5,
    id: "moonstrong",
    question: "When the Moon is strong, does it change how often you go back to old favorites?",
    story: "The Moon rules moods, memory and home. Dignified in Cancer or Taurus, she's said to be content and steady.",
    shortName: "Strong Moon",
    // Old favorites since 1 Oct 2026 (Blake, the folklore proposal): the lore's
    // comfort, memory and home. Before, how much you listen.
    measure: "oldfavorites",
    period: TROPICAL_MONTH,
    warmupDays: 365,
    nasa: false,
    subject: "a strong Moon",
    plural: false,
    when: "while the Moon was strong",
    eventNoun: { one: "visit", many: "visits" },
    howOften: "the Moon is strong",
  },
  {
    number: 6,
    id: "venusmars",
    question: "When Venus and Mars get along, do you listen more, or less?",
    story: "Venus is what you love, and Mars is how you go after it. In a trine or sextile, the two are said to pull together.",
    shortName: "Venus and Mars",
    // How much you listen since 1 Oct 2026: desire and drive flowing. Before,
    // after-midnight plays, which the lore never predicts.
    measure: "listening",
    warmupDays: 0,
    nasa: false,
    subject: "Venus and Mars getting along",
    plural: false,
    when: "while Venus and Mars got along",
    eventNoun: { one: "stretch", many: "stretches" },
    howOften: "Venus and Mars get along",
  },
  {
    number: 7,
    id: "storms",
    question: "Do solar storms change how late you listen?",
    story: "When the solar wind hits hard, auroras spread far from the poles, and folklore says people feel wired, restless and slow to sleep.",
    shortName: "Solar storms",
    measure: "aftermidnight",
    warmupDays: 0,
    nasa: true,
    subject: "solar storms",
    plural: true,
    when: "on storm nights",
    eventNoun: { one: "stretch of storm nights", many: "stretches of storm nights" },
    howOften: "storms come",
  },
  {
    number: 8,
    id: "flares",
    question: "Do big solar flares change how much you listen?",
    story: "X-class flares are the Sun at its loudest, and the lore says they turn up whatever you're already feeling.",
    shortName: "Big flares",
    measure: "listening",
    warmupDays: 0,
    nasa: true,
    subject: "big solar flares",
    plural: true,
    when: "on X-flare nights",
    eventNoun: { one: "stretch of X-flare nights", many: "stretches of X-flare nights" },
    howOften: "big flares come",
  },
  {
    number: 9,
    id: "marswater",
    question: "Does Mars in a water sign change how late you listen?",
    story: "In Cancer, Scorpio or Pisces, Mars is said to turn inward: he broods, plans in silence, and slowly comes to a boil.",
    shortName: "Mars in water",
    measure: "aftermidnight",
    warmupDays: 0,
    nasa: false,
    subject: "Mars in a water sign",
    plural: false,
    when: "while Mars was in a water sign",
    eventNoun: { one: "stretch", many: "stretches" },
    howOften: "Mars is in a water sign",
  },
  {
    number: 10,
    id: "venusdet",
    question: "When Venus is in detriment, does your listening change?",
    story: "Opposite her homes, Venus works harder for what she wants: bold in Aries, intense in Scorpio. The lore is clear it isn't bad luck.",
    shortName: "Venus in detriment",
    measure: "listening",
    warmupDays: 0,
    nasa: false,
    subject: "Venus in detriment",
    plural: false,
    when: "while Venus was in detriment",
    eventNoun: { one: "stretch", many: "stretches" },
    howOften: "Venus is in detriment",
  },
  {
    number: 11,
    id: "venusrx",
    question: "Does Venus retrograde change how often you go back to old favorites?",
    story: "About every 19 months, Venus turns back for six weeks, and the lore says old loves come back around, and their songs with them.",
    shortName: "Venus retrograde",
    measure: "oldfavorites",
    warmupDays: 365,
    nasa: false,
    subject: "Venus retrograde",
    plural: false,
    when: "while Venus was retrograde",
    eventNoun: { one: "retrograde", many: "retrogrades" },
    howOften: "Venus turns retrograde",
  },
  {
    number: 12,
    id: "marsrx",
    question: "Does Mars retrograde change how much you listen?",
    story: "About every two years, Mars turns back for two or three months, and the lore says drive stalls and momentum slips.",
    shortName: "Mars retrograde",
    measure: "listening",
    warmupDays: 0,
    nasa: false,
    subject: "Mars retrograde",
    plural: false,
    when: "while Mars was retrograde",
    eventNoun: { one: "retrograde", many: "retrogrades" },
    howOften: "Mars turns retrograde",
  },
];

export const questionById = (id: QuestionId): Question => QUESTIONS.find((q) => q.id === id)!;
