/**
 * The landing's sample listener (spec 8.1): a made-up history, run through
 * the real routes in-process, and written to `public/samples/` as the routes
 * answered. Never a real person's listening, and never a real store: every
 * read and write goes to a `MemoryBlobStore`, checked before each step.
 *
 * Rerun after anything the routes say changes:
 *
 *     WRITE_SAMPLES=1 npx vitest run src/lib/samples.test.ts
 *
 * Without `WRITE_SAMPLES` the same test regenerates the files in memory and
 * fails when the committed ones differ, so the samples' words keep following
 * the real rule. The caller (that test) mocks `next/server`'s `after`, fails
 * every fetch and fixes the clock at `SAMPLE_NOW`; nothing here reaches the
 * network.
 *
 * The listener is round 2's (`finding-retrospect-ux/redesign/v2/data`): its
 * plays and after-midnight plays for each of 1,096 nights, its first
 * scrobble's minute, and its named songs' first-play minutes and play
 * counts, under other songs (see `ROUND_2`). The rest of the history is
 * generated, seeded, so every run is the same:
 *
 * - 40 more songs, real ones, first played in the months whose nights the
 *   samples ship, so every song the sample can open has its night. They and
 *   the named songs are the only songs with 12 plays or more, so the songs
 *   the routes select (the top 50) are exactly these.
 * - Everything else is filler: songs played at most 11 times, which no route
 *   ever names. Their titles stay in this process.
 * - The sky is the real one, and NASA's log is the committed fixture
 *   (`src/lib/answers/testdata/donki-compact.json`, read 1 Oct 2026).
 * - NASA's photos and JPL's flybys are real too, from
 *   `scripts/sample-space.json` (`node scripts/sample-space.mjs`): EPIC's
 *   Earth and SDO's Sun for the months the samples show, and close
 *   approaches and fireballs for the whole history.
 */
import type { Scrobble } from "@/lib/analysis/nostalgia";
import { mulberry32 } from "@/lib/analysis/rng";
import { writeTagStore } from "@/lib/genres";
import { emptyCompact, writeCompact, type DonkiCompact } from "@/lib/space/compact";
import { forgetFinalMonths, monthsBetween, SPACE_PREFIX, writeMonth, writeSpaceJson, type SpaceMonth, type SpaceSource } from "@/lib/space/store";
import { getBlobStore, MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { getStore } from "@/lib/store/jsonStore";
import { intlOffset } from "@/lib/zone";
import donki from "@/lib/answers/testdata/donki-compact.json";
import space from "./sample-space.json";
import { GET as answersRoute } from "@/app/api/user/[name]/answers/route";
import { GET as songsRoute } from "@/app/api/user/[name]/songs/route";
import { GET as highlightsRoute } from "@/app/api/user/[name]/highlights/route";
import { GET as nightsRoute } from "@/app/api/user/[name]/nights/route";
import { GET as genresRoute } from "@/app/api/user/[name]/genres/route";

export const SAMPLE_USERNAME = "sample";
export const SAMPLE_ZONE = "America/Chicago";
/**
 * The clock the routes run at. A committed sample is read for years, so it
 * is computed as of a moment after the sky data ends (2035, spec 7.2): with
 * no event left to come, the answers name none, and nothing the files say
 * depends on when they're read ("The next one begins Saturday", a heads-up).
 * Every date in them is a dated fact about the history.
 */
export const SAMPLE_NOW = "2036-01-01T18:00:00Z";
/** The nights the landing opens directly (8.1): the hero's and a tile's. */
export const SAMPLE_NIGHTS = ["2024-04-08", "2024-05-10"];

/* ---- Round 2's nights ------------------------------------------------------ */

/** The first night, Sept 28, 2023; 1,096 nights to Sept 27, 2026. */
const FIRST_NIGHT = "2023-09-28";
/** Each night's plays, two base-36 digits a night (round 2's `daily`). */
const PLAYS = [
  "0v160y0l0q0r0z15131g171e1b1b1l0v1g0p140s0u1i150y0l0m1s0v120v140q1a0q1v1c23220l0l1a0n0u0w170v160y1g0v1c0t0u1j0v1j",
  "3h1d0s0w0r150i121k131j1c1v0x0n1f270i0t151n2m1n161s161n190o1p140t0v0x1j191w1k191x0q16162a0v0x0x121r0s1a1z17111b1t",
  "1c111r0x14130p112g16180s0d11143b190y210z0z2a1h0u0v0s100p111t1l0j200t1m111b0z0t1b141d1c1i1l1e14100w0y1i1f0l19171n",
  "0w1x2m0t0u0t17200u0o0m1c0l1p101c0l1b0p2a0j1p11121a0s0e1b1a1c1d0k0v0r161d1l1l0o0u0m1s150y170n0j0o1i1a1f0p101j0r0t",
  "0n13130j150t0q0j0v1a0z0i0e0z151d140t0j0j100q0y110y0p0t0l0v0y0n0y0h0z1k100r0m0t0h0q0u0w12120r0r0u0s0m1e0o0i0f0n15",
  "0z1f0n0k0y0k0k0i0v0r0r0q0n0n1d0z140f0k0k0v0t0s0u0c130q0r0i0q0p0e0n0n0u1c1v0y0g0p110o0i111d120s0t0j0j190k0k0i0n0s",
  "0i15110k0j15100r15180f1f1r0k1f0w0x0p101128100v1e0x0h0r0l0w0z0u130s0v0s0s1b0z0j0j11121c0u0y0t2q0t1i0z121m190u0n1c",
  "0z1z1z0v16100x21191h0s150u1e111k2a0j130u1u151m120m0u0y0m141h1n0o191c0z0p260g191i0s0t151m210l10190q0u0v1a0s132312",
  "1e1w130d1b1j1f0k0x26100y190n0v1m1n0o1k1h111y1r1j0w101e1t0y311m0s1j140u1a1y1o0s1x1214241u130v1v1q0i1a1x1v0r1f221m",
  "1x1n0l0w17281g1b1a1i191b1l0t1x12150508060804070f040c091r100x3l130x1e0y0g1l26131e19110y171m151w1c1l2n1l1n150o1v0y",
  "1n0s1b111d0y171u181y130w0t171m1v1a0y16190x0u0w0j0w0u0r170x1a1i1c0k0t0w0s1i1j0o1m230y140t180s0r0t1m0u1a110s0y1g0j",
  "101r0s0u0n18190r0y1a0v0i121c1g11130q0v120u0t0y0j0e15150t17131j0f1a0x140r1f0n0e0v1a1g110r1f0q0u14161r0s1a0g0q151x",
  "17170q0k0z0s0k0u0v0r0x0s0k0p1a0n0r0y0w1i14110r0r0u1g0r0r161c0w0j0k0r0y0q1b0p0l0u0n0e0u17170e1q170n0q1h100g0l0o19",
  "161h110m0s0w0p0z0o120j12130p18110u0j0i1k0u0x120z0q0s0x1u1d121c1d0x120w17220x160m0b0r0u1k0z0i0w120n102j180x0o0g0x",
  "282j1i0k0h1314172d1h10170i1c0p1g1d160t1s1b1719140q0y0x1017252k0y1819141p1n0m190u1z150t1j280r101c1v130r131h170s18",
  "190k1n1k0q0u0v111m0z0u121l1r1l2n210z141r1a111g0v0u0t1d230w2s1q140i0i1k1f1y0z1r25100v1d2d1l130t1e1b12190v0y1h112v",
  "130z29190h1c141k0z1812161a1e1d152311132d27111s331h17140s0s0r110k1l141i1u1d1o1617120t1k102t110v0x1r131h1z1d0i141u",
  "1i2911160r15111o3i18121d1a0j1i212n0l16140z152b1d1e151c23150x1m0w191h1c1i1v110z0t240w1n1r211b1h131r0u1r1l0h1p0x13",
  "171q1k0j0j0s0q0m0y1h0j0y120m10120r0i0s0s1q1f1823111n0v1p0v1q11140k1p0p0q1a100p0k0r0m1714200f14120q10100n100k140j",
  "0u12100q0r0w0s0x140r0u0h0l0b0r0w0t0s0h0o1p14171a0b0k0u0s151c0v0s",
].join("");
/** Of each night's plays, how many after midnight (0:00 to 3:59 the next
    morning), one base-36 digit a night. */
const AFTER_MIDNIGHT = [
  "21100053243445318131513501225130416158022225444122431402c4411212203341132210235441323522220398111059221211341434",
  "16b212034320123e604315615111457130544424243242221225162425612018110105044307186252120440113672112522312154211322",
  "2445200046010232100002131211112112411201111411430140111425212020321101232101202203121100011051021104231120620023",
  "02300111130222422123222322103242231334203534432110653214088234372320151340301114111314404712c1252015822420463533",
  "3a72003027222106604234461253472160017324125652571367122247312332240351234000010101050283120014353212422207342021",
  "4220011444431132212033110001173110138b168311520002312120194213103310244571011111013101b0322031112541521121220203",
  "0130020002100134131510250600222211113112204263223032301120112302322300026015336140231331222272100213210201311103",
  "5210110187220102632353120213479215135111513450543186141523300112314332285135712503050611011425762318a00532311525",
  "3782044122413224515221363011122030625615612291113243401313224122c2232116912231b554232251021152136115513052480132",
  "4661010037100013012142551122024111002121012451332322113344410003413010281301213200020113",
].join("");

export const NIGHTS = AFTER_MIDNIGHT.length;
export const playsOn = (i: number) => parseInt(PLAYS.slice(2 * i, 2 * i + 2), 36);
export const afterMidnightOn = (i: number) => parseInt(AFTER_MIDNIGHT[i], 36);

/* ---- Songs ----------------------------------------------------------------- */

export interface CatalogSong {
  artist: string;
  track: string;
  /** The first play, Chicago wall time, "YYYY-MM-DDTHH:MM". */
  first: string;
  plays: number;
}

/** Round 2's first plays and play counts, under less poppy songs than its
    own (2 Oct 2026): one Chappell Roan left, and a zodiac sign for the
    eclipse. Kyoto stands in for round 2's unnamed first scrobble. */
export const ROUND_2: CatalogSong[] = [
  { artist: "Phoebe Bridgers", track: "Kyoto", first: "2023-09-28T18:44", plays: 30 },
  { artist: "Phoebe Bridgers", track: "Motion Sickness", first: "2023-10-14T12:41", plays: 212 },
  { artist: "Clairo", track: "Bags", first: "2023-12-01T23:05", plays: 84 },
  { artist: "Boards of Canada", track: "Aquarius", first: "2024-04-08T13:38", plays: 160 },
  { artist: "Beach House", track: "Space Song", first: "2024-04-19T16:12", plays: 58 },
  { artist: "Chappell Roan", track: "Good Luck, Babe!", first: "2024-05-10T22:22", plays: 143 },
  { artist: "Big Thief", track: "Not", first: "2024-06-29T08:49", plays: 131 },
  { artist: "Clairo", track: "Juna", first: "2024-07-12T00:30", plays: 66 },
  { artist: "Slowdive", track: "When the Sun Hits", first: "2024-10-03T07:18", plays: 49 },
  { artist: "MJ Lenderman", track: "She's Leaving You", first: "2024-10-10T21:40", plays: 71 },
  { artist: "Tame Impala", track: "The Less I Know the Better", first: "2025-03-14T01:58", plays: 77 },
  { artist: "Cocteau Twins", track: "Heaven or Las Vegas", first: "2025-06-05T07:03", plays: 38 },
  { artist: "Wet Leg", track: "catch these fists", first: "2025-08-01T21:15", plays: 45 },
];

/** 40 more real songs, each first played after its release, in a month the
    named songs already need, with 12 to 37 plays: fewer than any named song
    the routes select, more than any filler. */
export const MORE: CatalogSong[] = [
  { artist: "Mannequin Pussy", track: "I Got Heaven", first: "2024-04-10T20:14", plays: 37 },
  { artist: "Boards of Canada", track: "Roygbiv", first: "2024-04-08T13:52", plays: 24 },
  { artist: "The Smile", track: "Friend of a Friend", first: "2024-04-24T19:31", plays: 18 },
  { artist: "Stereolab", track: "French Disko", first: "2024-04-16T08:12", plays: 15 },
  { artist: "Waxahatchee", track: "Right Back to It", first: "2024-04-27T22:48", plays: 13 },
  { artist: "Kendrick Lamar", track: "Not Like Us", first: "2024-05-05T11:20", plays: 29 },
  { artist: "Fontaines D.C.", track: "Starburster", first: "2024-05-14T17:45", plays: 14 },
  { artist: "Khruangbin", track: "May Ninth", first: "2024-05-10T23:05", plays: 33 },
  { artist: "LCD Soundsystem", track: "All My Friends", first: "2024-05-22T21:02", plays: 20 },
  { artist: "Adrianne Lenker", track: "Sadness as a Gift", first: "2024-05-28T00:41", plays: 26 },
  { artist: "Pavement", track: "Harness Your Hopes", first: "2024-06-02T18:26", plays: 22 },
  { artist: "Mazzy Star", track: "Fade Into You", first: "2024-06-09T22:10", plays: 27 },
  { artist: "Big Thief", track: "Shark Smile", first: "2024-06-29T09:03", plays: 25 },
  { artist: "Clairo", track: "Sexy to Someone", first: "2024-06-14T20:33", plays: 16 },
  { artist: "Charli xcx", track: "360", first: "2024-06-21T21:47", plays: 31 },
  { artist: "The Marías", track: "No One Noticed", first: "2024-07-03T23:12", plays: 19 },
  { artist: "Portishead", track: "Roads", first: "2024-07-08T16:55", plays: 17 },
  { artist: "Wednesday", track: "Bull Believer", first: "2024-07-19T21:30", plays: 23 },
  { artist: "Clairo", track: "Nomad", first: "2024-07-12T00:47", plays: 21 },
  { artist: "Mk.gee", track: "Are You Looking Up", first: "2024-07-26T13:18", plays: 12 },
  { artist: "Duster", track: "Me and the Birds", first: "2024-10-01T19:40", plays: 30 },
  { artist: "MJ Lenderman", track: "Wristwatch", first: "2024-10-10T22:05", plays: 28 },
  { artist: "Sufjan Stevens", track: "Chicago", first: "2024-10-17T20:52", plays: 14 },
  { artist: "Elliott Smith", track: "Between the Bars", first: "2024-10-25T23:30", plays: 18 },
  { artist: "Slowdive", track: "Alison", first: "2024-10-03T08:02", plays: 20 },
  { artist: "Black Country, New Road", track: "Concorde", first: "2025-03-02T21:15", plays: 26 },
  { artist: "Fleet Foxes", track: "Mykonos", first: "2025-03-07T17:40", plays: 15 },
  { artist: "Tame Impala", track: "Let It Happen", first: "2025-03-14T02:20", plays: 19 },
  { artist: "Grizzly Bear", track: "Two Weeks", first: "2025-03-21T22:44", plays: 24 },
  { artist: "Animal Collective", track: "My Girls", first: "2025-03-28T19:09", plays: 16 },
  { artist: "Bon Iver", track: "Everything Is Peaceful Love", first: "2025-06-06T20:20", plays: 21 },
  { artist: "Sharon Van Etten", track: "Seventeen", first: "2025-06-12T21:58", plays: 27 },
  { artist: "The National", track: "Bloodbuzz Ohio", first: "2025-06-18T08:35", plays: 13 },
  { artist: "Built to Spill", track: "Carry the Zero", first: "2025-06-24T22:16", plays: 17 },
  { artist: "Cocteau Twins", track: "Cherry-coloured Funk", first: "2025-06-05T07:40", plays: 23 },
  { artist: "Talk Talk", track: "Life's What You Make It", first: "2025-08-08T21:03", plays: 22 },
  { artist: "Broadcast", track: "Come On Let's Go", first: "2025-08-15T18:27", plays: 14 },
  { artist: "Wet Leg", track: "CPR", first: "2025-08-01T21:31", plays: 19 },
  { artist: "Radiohead", track: "Weird Fishes/Arpeggi", first: "2025-08-22T23:40", plays: 16 },
  { artist: "Talking Heads", track: "This Must Be the Place (Naive Melody)", first: "2025-08-29T20:11", plays: 25 },
];

export const CATALOG = [...ROUND_2, ...MORE];

/** Filler songs stop here, below every catalog song's count. */
const FILLER_CAP = 11;

/** Each artist's genre, as Last.fm's top tag might put it, and how often the
    filler reaches for them. */
export const ARTISTS: Record<string, { tag: string; filler: number }> = {
  Radiohead: { tag: "alternative", filler: 6 },
  "Phoebe Bridgers": { tag: "indie folk", filler: 6 },
  "Big Thief": { tag: "indie folk", filler: 6 },
  "Boards of Canada": { tag: "electronic", filler: 5 },
  Clairo: { tag: "bedroom pop", filler: 5 },
  Slowdive: { tag: "shoegaze", filler: 4 },
  "Beach House": { tag: "dream pop", filler: 4 },
  "Tame Impala": { tag: "psychedelic rock", filler: 4 },
  "Bon Iver": { tag: "indie folk", filler: 4 },
  Khruangbin: { tag: "psychedelic", filler: 3 },
  "Cocteau Twins": { tag: "dream pop", filler: 3 },
  "MJ Lenderman": { tag: "alt-country", filler: 3 },
  "Talking Heads": { tag: "new wave", filler: 3 },
  "LCD Soundsystem": { tag: "electronic", filler: 3 },
  boygenius: { tag: "indie rock", filler: 3 },
  Mitski: { tag: "indie rock", filler: 3 },
  "Japanese Breakfast": { tag: "indie pop", filler: 2 },
  Wednesday: { tag: "indie rock", filler: 2 },
  "Mannequin Pussy": { tag: "punk", filler: 2 },
  "Wet Leg": { tag: "indie rock", filler: 2 },
  "Adrianne Lenker": { tag: "indie folk", filler: 2 },
  Waxahatchee: { tag: "indie folk", filler: 2 },
  "Fontaines D.C.": { tag: "post-punk", filler: 2 },
  Portishead: { tag: "trip-hop", filler: 2 },
  "Sufjan Stevens": { tag: "indie folk", filler: 2 },
  "Elliott Smith": { tag: "singer-songwriter", filler: 2 },
  "Fleet Foxes": { tag: "indie folk", filler: 2 },
  "Grizzly Bear": { tag: "indie rock", filler: 2 },
  "The National": { tag: "indie rock", filler: 2 },
  "Kendrick Lamar": { tag: "hip-hop", filler: 2 },
  "Mk.gee": { tag: "indie", filler: 2 },
  beabadoobee: { tag: "bedroom pop", filler: 2 },
  "The Smile": { tag: "alternative", filler: 2 },
  Pavement: { tag: "indie rock", filler: 2 },
  "Mazzy Star": { tag: "dream pop", filler: 2 },
  "The Marías": { tag: "dream pop", filler: 2 },
  Stereolab: { tag: "post-rock", filler: 1 },
  "Charli xcx": { tag: "electropop", filler: 2 },
  Duster: { tag: "slowcore", filler: 1 },
  "Black Country, New Road": { tag: "post-rock", filler: 1 },
  "Animal Collective": { tag: "experimental", filler: 1 },
  "Sharon Van Etten": { tag: "indie rock", filler: 1 },
  "Built to Spill": { tag: "indie rock", filler: 1 },
  "Talk Talk": { tag: "new wave", filler: 1 },
  Broadcast: { tag: "dream pop", filler: 1 },
  "Chappell Roan": { tag: "pop", filler: 1 },
  Djo: { tag: "indie rock", filler: 1 },
  Laufey: { tag: "jazz", filler: 1 },
  "Noah Kahan": { tag: "folk", filler: 1 },
  "Lizzy McAlpine": { tag: "indie folk", filler: 1 },
};

/* ---- Time ------------------------------------------------------------------ */

const DAY = 86_400;

/** Unix seconds of a Chicago wall time, given as seconds since 1970 read as if UTC. */
function fromWall(wall: number): number {
  return wall - intlOffset(SAMPLE_ZONE, wall - intlOffset(SAMPLE_ZONE, wall));
}

/** "2024-04-08T13:38", Chicago, as Unix seconds. */
export const chicago = (local: string) => fromWall(Date.parse(`${local}:00Z`) / 1000);

/** The night a Chicago instant belongs to: 4 a.m. to 4 a.m. (7.1), as an index from FIRST_NIGHT. */
function nightIndex(uts: number): number {
  const wall = uts + intlOffset(SAMPLE_ZONE, uts) - 4 * 3600;
  return Math.floor(wall / DAY) - Date.parse(`${FIRST_NIGHT}T00:00:00Z`) / 1000 / DAY;
}

/* ---- The history ----------------------------------------------------------- */

interface Slot {
  uts: number;
  song: number | null;
}

/** Play times inside [from, to] (wall seconds): sessions of consecutive
    songs 2.5 to 5.5 minutes apart, starting mostly in the evening. */
function sessions(rng: () => number, count: number, from: number, to: number, evening: boolean): number[] {
  const out: number[] = [];
  let left = count;
  while (left > 0) {
    const len = Math.min(left, 3 + Math.floor(rng() * 14));
    left -= len;
    const span = len * 330;
    const latest = Math.max(from, to - span);
    let start: number;
    const day0 = from - (from % DAY);
    const eveningStart = Math.max(from, day0 + 18 * 3600);
    if (evening && rng() < 0.62 && eveningStart < latest) start = eveningStart + rng() * (latest - eveningStart);
    else start = from + rng() * (latest - from);
    let t = Math.floor(start);
    for (let k = 0; k < len; k++) {
      out.push(Math.min(t, to));
      t += 150 + Math.floor(rng() * 180);
    }
  }
  return out;
}

/**
 * The whole made-up history, sorted by time: 44,088 plays, each night's
 * count and after-midnight count round 2's, each catalog song first played
 * at its minute and played its count, and filler for the rest.
 */
export function sampleHistory(): Scrobble[] {
  const rng = mulberry32(20231928);
  const firsts = CATALOG.map((s) => chicago(s.first));
  const anchorsBy = new Map<number, number[]>();
  firsts.forEach((uts, song) => {
    const n = nightIndex(uts);
    if (n < 0 || n >= NIGHTS) throw new Error(`${CATALOG[song].track}: first play outside the history`);
    anchorsBy.set(n, [...(anchorsBy.get(n) ?? []), song]);
  });

  const nightZero = Date.parse(`${FIRST_NIGHT}T00:00:00Z`) / 1000;
  const slots: Slot[] = [];
  for (let n = 0; n < NIGHTS; n++) {
    const date = nightZero + n * DAY;
    const anchors = anchorsBy.get(n) ?? [];
    const late = anchors.filter((s) => (firsts[s] + intlOffset(SAMPLE_ZONE, firsts[s])) % DAY < 4 * 3600);
    const early = anchors.filter((s) => !late.includes(s));
    // Round 2 counted by calendar day; a first play after midnight needs an after-midnight play.
    const after = Math.max(afterMidnightOn(n), late.length);
    const before = playsOn(n) - after;
    if (before < early.length) throw new Error(`night ${n}: more first plays than plays`);
    // The first night starts with the first scrobble, Kyoto at 6:44 p.m.
    const dayFrom = n === 0 ? date + 18 * 3600 + 45 * 60 : date + 9 * 3600;
    const times = [
      ...sessions(rng, before, dayFrom, date + 23 * 3600 + 58 * 60, true).map((w) => ({ uts: fromWall(w), late: false })),
      ...sessions(rng, after, date + DAY + 60, date + DAY + 3 * 3600 + 50 * 60, false).map((w) => ({ uts: fromWall(w), late: true })),
    ];
    const night: Slot[] = times.map((t) => ({ uts: t.uts, song: null }));
    // Each first play takes the nearest play of its part of the night, at its own minute.
    for (const song of anchors) {
      const isLate = late.includes(song);
      let best = -1;
      for (let i = 0; i < night.length; i++) {
        if (night[i].song !== null || times[i].late !== isLate) continue;
        if (best < 0 || Math.abs(night[i].uts - firsts[song]) < Math.abs(night[best].uts - firsts[song])) best = i;
      }
      night[best] = { uts: firsts[song], song };
    }
    slots.push(...night);
  }
  slots.sort((a, b) => a.uts - b.uts || (a.song ?? -1) - (b.song ?? -1));

  // Each catalog song's other plays: heavy in its first weeks, then tapering.
  const position = new Map<number, number>();
  slots.forEach((s, i) => s.song !== null && position.set(s.song, i));
  CATALOG.forEach((song, id) => {
    const from = position.get(id)! + 1;
    const weights: number[] = [];
    let total = 0;
    for (let i = from; i < slots.length; i++) {
      const days = (slots[i].uts - firsts[id]) / DAY;
      total += Math.exp(-days / 45) + 0.04;
      weights.push(total);
    }
    let placed = 1;
    for (let tries = 0; placed < song.plays; tries++) {
      if (tries > 100_000) throw new Error(`${song.track}: no room for its plays`);
      const r = rng() * total;
      let lo = 0;
      let hi = weights.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (weights[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      const slot = slots[from + lo];
      if (slot.song !== null) continue;
      slot.song = id;
      placed++;
    }
  });

  // Filler: a new song (16%), a recent discovery (52%) or an older one,
  // weighted toward the oldest, so first listens, replays and old
  // favorites all happen. None reaches the catalog's counts.
  const pickArtist = (() => {
    const names = Object.keys(ARTISTS).filter((a) => ARTISTS[a].filler > 0);
    const total = names.reduce((t, a) => t + ARTISTS[a].filler, 0);
    return () => {
      let r = rng() * total;
      for (const a of names) if ((r -= ARTISTS[a].filler) < 0) return a;
      return names[names.length - 1];
    };
  })();
  const filler: { artist: string; track: string; plays: number }[] = [];
  const perArtist = new Map<string, number>();
  const newFiller = () => {
    const artist = pickArtist();
    const k = (perArtist.get(artist) ?? 0) + 1;
    perArtist.set(artist, k);
    filler.push({ artist, track: `Filler ${k}`, plays: 0 });
    return filler.length - 1;
  };
  const out: Scrobble[] = [];
  for (const slot of slots) {
    if (slot.song !== null) {
      const s = CATALOG[slot.song];
      out.push({ uts: slot.uts, artist: s.artist, track: s.track });
      continue;
    }
    let pick = -1;
    const r = rng();
    if (filler.length > 0 && r >= 0.16) {
      pick =
        r < 0.68
          ? filler.length - 1 - Math.floor(rng() * Math.min(filler.length, 400))
          : Math.floor(filler.length * rng() * rng());
      if (filler[pick].plays >= FILLER_CAP) pick = -1;
    }
    if (pick < 0) pick = newFiller();
    filler[pick].plays++;
    out.push({ uts: slot.uts, artist: filler[pick].artist, track: filler[pick].track });
  }
  return out;
}

/* ---- Running the routes ---------------------------------------------------- */

type Route = (req: Request, ctx: { params: Promise<{ name: string }> }) => Promise<Response>;

/**
 * The sample listener and NASA's data for it, written into whatever blob
 * store is current: its history, its artists' tags, NASA's log and photos,
 * and a ready sync state. The samples write it to a memory store; the
 * browser checks (`e2e/`) to a fresh folder, never a real store.
 *
 * `freshAt` stamps NASA's log as read at that moment, so a server reading
 * it never refreshes it from NASA; the months after the fixture's last read
 * count as quiet. Without it the log keeps the fixture's own stamp, so the
 * samples read the same every time.
 */
export async function writeSampleListener(username = SAMPLE_USERNAME, freshAt?: Date): Promise<Scrobble[]> {
  // The fixture predates the log's storm starts; the rest is the log as NASA had it.
  const fixture = donki as unknown as Partial<DonkiCompact>;
  const log: DonkiCompact = { ...emptyCompact(), ...fixture };
  if (freshAt) {
    // Copies: the imported fixture stays as committed for anything else in this process.
    log.kp = { ...log.kp };
    log.xflares = { ...log.xflares };
    log.kpAt = { ...log.kpAt };
    log.xflaresAt = { ...log.xflaresAt };
    const stamp = freshAt.toISOString();
    for (const m of monthsBetween(log.refreshedAt.slice(0, 7), stamp.slice(0, 7))) {
      log.kp[m] ??= [];
      log.xflares[m] ??= [];
      log.kpAt[m] = log.xflaresAt[m] = stamp;
    }
    log.refreshedAt = stamp;
  }
  await writeCompact(log);
  // NASA's months for the sample, and EPIC's list of its days, as the
  // fill's own index keeps it: a day EPIC doesn't list reads "none" (7.3).
  for (const file of space.months) await writeMonth(file as SpaceMonth<SpaceSource>);
  await writeSpaceJson(`${SPACE_PREFIX}epic-done.json`, { days: space.epicListed, available: space.epicListed });
  const history = sampleHistory();
  await getStore().appendScrobbles(username, history);
  const artists = [...new Set(history.map((p) => p.artist))];
  await writeTagStore(username, {
    artists: Object.fromEntries(artists.map((a) => [a.toLowerCase(), [ARTISTS[a].tag]])),
  });
  await getStore().setSyncState({
    username,
    status: "ready",
    pagesDone: 1,
    totalPages: 1,
    totalScrobbles: history.length,
    newestUts: history[history.length - 1].uts,
    oldestUts: history[0].uts,
    updatedAt: Date.now(),
  });
  return history;
}

/** Every committed file, by name, as the JSON text written to `public/samples/`. */
export async function generateSamples(): Promise<Map<string, string>> {
  const memory = new MemoryBlobStore();
  setBlobStore(memory);
  const inMemory = () => {
    if (getBlobStore() !== memory) throw new Error("The sample may only ever use its own memory store");
  };
  forgetFinalMonths();
  try {
    inMemory();
    const history = await writeSampleListener();

    const call = async (route: Route, query = "") => {
      inMemory();
      const res = await route(new Request(`http://sample.local/api/user/${SAMPLE_USERNAME}/x?tz=${encodeURIComponent(SAMPLE_ZONE)}${query}`), {
        params: Promise.resolve({ name: SAMPLE_USERNAME }),
      });
      const body = await res.json();
      if (res.status !== 200 || body.status === "computing" || body.status === "building") {
        throw new Error(`A sample route answered ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      }
      return body;
    };

    const files = new Map<string, unknown>();
    // The status route would sync from Last.fm; this is what it reports once ready.
    files.set("status.json", {
      status: "ready",
      pagesDone: 1,
      totalPages: 1,
      totalScrobbles: history.length,
      newestUts: history[history.length - 1].uts,
      oldestUts: history[0].uts,
      error: null,
      code: null,
    });
    files.set("answers.json", await call(answersRoute));
    const songs = await call(songsRoute);
    files.set("songs.json", songs);
    files.set("highlights.json", await call(highlightsRoute));
    files.set("genres.json", await call(genresRoute));
    // The nights the sample can open: the landing's two, and every selected song's first night.
    const months = new Set(SAMPLE_NIGHTS.map((d) => d.slice(0, 7)));
    for (const s of [...songs.row, ...songs.listed]) months.add(s.firstNight.slice(0, 7));
    for (const m of [...months].sort()) files.set(`nights-${m}.json`, await call(nightsRoute, `&from=${m}&to=${m}`));
    inMemory();
    return new Map([...files].map(([name, body]) => [name, `${JSON.stringify(body)}\n`]));
  } finally {
    // An empty memory store, never `null`: `null` hands the next caller the
    // environment's store, and a background job still running would write there.
    setBlobStore(new MemoryBlobStore());
  }
}
