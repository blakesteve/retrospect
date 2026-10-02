import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryBlobStore, setBlobStore, type BlobStore } from "@/lib/store/blob";
import { latestEpic } from "./latestEpic";
import { forgetFinalMonths, writeMonth, type EpicDay } from "./store";

/* Tonight's photo of Earth (spec 8.4, 7.3). The days are made up in EPIC's
   shape (image names, UTC times, centroid longitudes), the camera seeing the
   side of Earth near local noon: about 150° east at 02:00 UTC, 90° west at
   18:00. A zone faces its standard offset times 15°: Chicago 90° west,
   Sydney 150° east, Kiritimati (UTC+14) 150° west, UTC 0. */

const at = (iso: string) => Date.parse(iso) / 1000;
const img = (time: string, lon: number) => ({ name: `epic_1b_${time.replace(/\D/g, "").slice(0, 14)}`, time, lat: 1, lon });

const SEPT: EpicDay[] = [
  { date: "2026-09-25", images: [img("2026-09-25T18:00:00Z", -90.1)] },
  { date: "2026-09-27", images: [img("2026-09-27T17:55:00Z", -88.9), img("2026-09-27T02:01:00Z", 149.8)] },
  {
    date: "2026-09-28",
    images: [
      img("2026-09-28T01:59:22Z", 150.3),
      img("2026-09-28T06:01:12Z", 89.6),
      img("2026-09-28T17:58:12Z", -89.9),
      img("2026-09-28T21:50:03Z", -147.2),
    ],
  },
  // EPIC listed the day with no photos.
  { date: "2026-09-29", images: [] },
];

const month = (m: string, records: EpicDay[]) =>
  writeMonth({ source: "epic", month: m, firstDate: "2015-06-13", refreshedAt: "2026-10-01T00:00:00.000Z", records });

beforeEach(async () => {
  forgetFinalMonths();
  setBlobStore(new MemoryBlobStore());
  await month("2026-09", SEPT);
});
afterEach(() => setBlobStore(null));

describe("the latest photo of Earth (spec 8.4)", () => {
  it("takes the latest day's photo facing the listener's longitude", async () => {
    const now = at("2026-09-29T03:00:00Z");
    expect(await latestEpic("America/Chicago", now)).toEqual({
      url: "https://epic.gsfc.nasa.gov/archive/natural/2026/09/28/jpg/epic_1b_20260928175812.jpg",
      date: "Sept 28",
      line: "Earth on Sept 28, from a million miles out",
      credit: "NASA EPIC team",
    });
    expect((await latestEpic("Australia/Sydney", now))?.url).toBe(
      "https://epic.gsfc.nasa.gov/archive/natural/2026/09/28/jpg/epic_1b_20260928015922.jpg",
    );
    // 89.6° east is nearer 0 than 89.9° west.
    expect((await latestEpic("UTC", now))?.url).toBe("https://epic.gsfc.nasa.gov/archive/natural/2026/09/28/jpg/epic_1b_20260928060112.jpg");
  });

  it("dates the photo when it was taken in the listener's zone, and links EPIC's own day", async () => {
    // 21:50 UTC on Sept 28 is 11:50 a.m. Sept 29 on Kiritimati.
    const epic = await latestEpic("Pacific/Kiritimati", at("2026-09-29T03:00:00Z"));
    expect(epic?.url).toBe("https://epic.gsfc.nasa.gov/archive/natural/2026/09/28/jpg/epic_1b_20260928215003.jpg");
    expect(epic?.line).toBe("Earth on Sept 29, from a million miles out");
  });

  it("keeps to the last 3 days, and leaves the horizon out with none", async () => {
    // At 18:00 UTC Oct 1, Sept 28's 17:58 photo is 3 days and 2 minutes old; 21:50's isn't.
    expect((await latestEpic("America/Chicago", at("2026-10-01T18:00:00Z")))?.url).toBe(
      "https://epic.gsfc.nasa.gov/archive/natural/2026/09/28/jpg/epic_1b_20260928215003.jpg",
    );
    expect(await latestEpic("America/Chicago", at("2026-10-02T00:00:00Z"))).toBeNull();
    // Nothing from after now: at 01:00 UTC Sept 28, the latest is Sept 27's.
    expect((await latestEpic("America/Chicago", at("2026-09-28T01:00:00Z")))?.url).toBe(
      "https://epic.gsfc.nasa.gov/archive/natural/2026/09/27/jpg/epic_1b_20260927175500.jpg",
    );
  });

  it("reads across a month's end", async () => {
    await month("2026-10", [{ date: "2026-10-01", images: [] }]);
    expect((await latestEpic("America/Chicago", at("2026-10-01T06:00:00Z")))?.date).toBe("Sept 28");
  });

  it("is null, not an error, when the store can't be read", async () => {
    const down = new Error("store down");
    const broken: BlobStore = {
      get: async () => {
        throw down;
      },
      put: async () => undefined,
      del: async () => undefined,
      has: async () => false,
      list: async () => [],
    };
    setBlobStore(broken);
    expect(await latestEpic("America/Chicago", at("2026-09-29T03:00:00Z"))).toBeNull();
  });
});
