/**
 * What the listener views read, and how. Types only from the server modules
 * (`import type` is erased), so no client chunk carries the sky data or the
 * analysis: every sentence arrives already worded (spec 7.4, 13.5).
 */
import type { AnswersPayload, ComputingPayload, QuestionPayload } from "@/lib/answers/payload";
import type { SongEntry } from "@/lib/listener/record";
import type { GenreFact } from "@/lib/listener/genres";
import type { QuestionId } from "@/lib/answers/questions";
import type { NoneOverhead, SkyFact, TonightMoon } from "@/lib/sky/tonight";
import type { SkyPath } from "@/lib/motion/wheelPath";
import { apiError } from "@/lib/visitorErrors";

export type { AnswersPayload, ComputingPayload, QuestionPayload, SongEntry, GenreFact, QuestionId, NoneOverhead, SkyFact, SkyPath };

export type Dignity = "home" | "exalted" | "detriment" | "fall" | "neutral";

export interface Planet {
  body: string;
  longitude: number;
  sign: string;
  degree: number;
  minute: number;
  dignity: Dignity;
  dignityPhrase: string;
  retrograde: boolean;
  /** "Venus in Scorpio · in her detriment" (9.3). */
  line?: string;
  /** "Venus at home · domicile in Taurus, 14°21′" (8.7.1). */
  detail?: string;
  /** The accessible name: "Venus in Scorpio, in her detriment". */
  name?: string;
}

export interface SkyAt {
  at: string;
  bodies: Planet[];
  moon: { phaseAngle: number; illumination: number; sign: string };
  aspects: { a: string; b: string; name: string; off: number }[];
  conditions: string[];
  questionsHeld?: QuestionId[];
}

export interface ComingUpItem {
  time: number;
  kind: "station" | "sign" | "moon" | "eclipse" | "condition";
  text: string;
  questions: QuestionId[];
  date: string;
  at: string;
  /** The body the moment is about, which pulses on the wheel (8.11). */
  body?: string | null;
}

export interface SkyNow {
  zone: string;
  zoneFellBack: boolean;
  sky: SkyAt;
  questionsHeld: QuestionId[];
  nasa: "ok" | "unavailable";
  comingUp: ComingUpItem[];
  heading?: string;
  timeLine?: string;
  moon?: Pick<TonightMoon, "phaseName" | "illumination" | "label" | "line"> & { lineNoSign?: string };
  /** Each held question's sky line, for "Tonight, for you" (8.4). */
  skyLines?: Partial<Record<QuestionId, string>>;
  /** Untested sky facts, in 8.4's order. */
  skyFacts?: SkyFact[];
  planets?: (Planet & { degreeText?: string })[];
  receptions?: string[];
  epic?: { url: string; date: string; line: string; credit: string } | null;
  noneOverhead?: NoneOverhead | null;
}

export interface WildNight {
  date: string;
  rank: number;
  title: string;
  story: string;
  eventId?: string;
  plays?: number;
  usual?: number | null;
  line?: string;
  dateLine?: string;
  kind?: "eclipse" | "storm" | "flare" | "asteroid";
  photo?: { url: string; credit: string; caption: string } | null;
  /** The Moon's phase angle at 9 p.m. that night, for a drawn sky (8.9). */
  moonPhase?: number;
}

export interface SurpriseItem {
  id: string;
  kind: "song" | "night" | "fact";
  songId?: string;
  date?: string;
  text?: string;
}

export interface Highlights {
  status: "ready" | "updating" | "computing";
  zone: string;
  length?: string;
  counts?: { plays: number; venusSignChanges: number; storms: number; flybys: number };
  wildCount?: number;
  wild?: WildNight[];
  /** `dateLine`: "Friday, May 10, 2024", the reveal card's eyebrow (8.3). */
  wildest?: { date: string; line: string; dateLine?: string } | null;
  strangest?: { songId: string; score: number; line: string } | null;
  surprise?: SurpriseItem[];
}

export interface Songs {
  status: "ready" | "updating" | "computing";
  zone: string;
  state?: "ready" | "too-few-plays";
  settleRuleDropped?: boolean;
  row?: SongEntry[];
  listed?: SongEntry[];
}

export interface NightSpace {
  known: { storms: boolean; flares: boolean; asteroids: boolean; fireballs: boolean };
  kp: number | null;
  stormGrade: string | null;
  stormLine: string | null;
  biggestFlare: string | null;
  xFlare: string | null;
  asteroid: { name: string; time: number; ld: number; meters: number; line: string } | null;
  fireballs: { time: number; kt: number | null; at: string }[];
  epic: { url: string; time: string; credit: string } | "none" | "unknown";
  photos: { kind: "curated" | "sdo"; url: string; page: string; caption: string; credit: string }[];
  /** Why a storm or flare night before 2016 has no Sun, or null (7.3). */
  sunNote: string | null;
}

export interface Night {
  date: string;
  plays: number;
  afterMidnight: number;
  usualForWeekday: number | null;
  firstPlays: { songId: string; artist: string; track: string; pairing: string | null }[];
  moon: { phaseAngle: number; illumination: number; sign: string };
  eclipse: { kind: string; time: number } | null;
  conditions: QuestionId[];
  filters: string[];
  wild: { rank: number; title: string; story: string } | null;
  genres: { genre: string; plays: number }[];
  space: NightSpace;
  /** Every sign change and station during the night, with its sentence (8.7.2). */
  changes?: { time: number; body: string; kind: "sign" | "station"; text: string }[];
  /** "from 10:13 p.m. CDT", for a condition that began or ended in the night. */
  conditionNotes?: Partial<Record<QuestionId, string>>;
}

export interface Nights {
  status: "ready" | "updating" | "computing";
  zone: string;
  nights?: Night[];
}

export interface Genres {
  status: "building" | "ready" | "failed";
  done: number;
  total: number;
  genres: GenreFact[];
}

export interface SyncStatus {
  status: "syncing" | "ready" | "error";
  pagesDone: number;
  totalPages: number;
  totalScrobbles: number;
  newestUts: number | null;
  oldestUts: number | null;
  error: string | null;
  code: string | null;
}

/** GET a JSON route, throwing the route's visitor-error code on failure. */
export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

export const userUrl = (username: string, route: string, zone: string, extra = "") =>
  `/api/user/${encodeURIComponent(username)}/${route}?tz=${encodeURIComponent(zone)}${extra}`;
