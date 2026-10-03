import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, setBlobStore } from "@/lib/store/blob";
import { PROGRESS_KEY, writeMonth, writeSpaceJson } from "./store";
import { runSpaceWork } from "./work";

vi.mock("./work", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./work")>()),
  runSpaceWork: vi.fn(async () => ({ skipped: false, ms: 5, fetches: 3, wrote: ["apod/2026-10"], failed: [], done: false, left: { epic: 4000, sdo: 12 } })),
}));
const pass = vi.mocked(runSpaceWork);

const { GET: apodRoute } = await import("@/app/api/apod/route");
const spaceCronModule = await import("@/app/api/cron/space/route");
const { GET: spaceCron } = spaceCronModule;
const { GET: progressRoute } = await import("@/app/api/space/progress/route");

let asked: string[];
beforeEach(() => {
  setBlobStore(new MemoryBlobStore());
  asked = [];
  pass.mockClear();
});
afterEach(() => {
  setBlobStore(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
const nasaReplies = (reply: (url: string) => Response) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      return reply(url);
    }),
  );

/* The route keeps what it found in memory for the life of the process, so
   each test asks for its own dates. */
const apod = async (date: string) => {
  const res = await apodRoute(new Request(`http://x/api/apod?date=${date}`));
  return { status: res.status, body: await res.json() };
};

describe("the APOD route", () => {
  const day = {
    date: "2024-05-10",
    title: "Aurora over the lake",
    credit: "Jane Doe",
    mediaType: "image",
    link: "https://science.nasa.gov/apod/2024/05/10/aurora/",
  };

  it("serves a stored day without asking NASA: title, credit and link, never a picture", async () => {
    await writeMonth({ source: "apod", month: "2024-05", firstDate: "1995-06-16", refreshedAt: "x", records: [day] });
    nasaReplies(() => new Response("", { status: 500 }));
    const res = await apod("2024-05-10");
    expect(res).toEqual({ status: 200, body: { ...day, requestedDate: "2024-05-10" } });
    expect(asked).toEqual([]);
    expect(Object.keys(res.body).sort()).toEqual(["credit", "date", "link", "mediaType", "requestedDate", "title"]);
  });

  it("asks science.nasa.gov for a day not stored yet, once", async () => {
    nasaReplies(() =>
      Response.json({ date: "2019-07-20", title: "Apollo 11", credit: "NASA", media_type: "image", permalink: "https://science.nasa.gov/apod/x/" }),
    );
    const first = await apod("2019-07-20");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ title: "Apollo 11", credit: "NASA", link: "https://science.nasa.gov/apod/x/" });
    await apod("2019-07-20");
    expect(asked).toEqual(["https://science.nasa.gov/wp-json/wp/v2/apod-basic/190720"]);
  });

  it("says when there's no picture, and when the date is bad, without asking NASA about a bad one", async () => {
    nasaReplies(() => new Response("{}", { status: 404 }));
    expect((await apod("2001-02-03")).status).toBe(404);
    asked = [];
    expect((await apod("2001-02-03")).status).toBe(404); // remembered
    expect((await apod("1995-06-15")).status).toBe(404); // before APOD began
    expect((await apod("2999-01-01")).status).toBe(404);
    expect((await apod("2024-5-10")).status).toBe(400);
    expect((await apod("2024-13-40")).status).toBe(400);
    // Dates Date.parse rolls over rather than refuses.
    expect((await apod("2024-02-31")).status).toBe(400);
    expect((await apod("2023-02-29")).status).toBe(400);
    expect((await apod("2024-02-29")).status).toBe(404); // real, and NASA has none here
    expect(asked).toHaveLength(1);
  });

  it("asks NASA at most once a minute about a date it couldn't reach", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    nasaReplies(() => new Response("", { status: 503 }));
    expect(await apod("2001-02-04")).toEqual({ status: 502, body: { error: "NASA unreachable" } });
    expect((await apod("2001-02-04")).status).toBe(502);
    expect(asked).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-01T12:01:01Z"));
    nasaReplies(() => Response.json({ date: "2001-02-04", title: "Back", credit: "", media_type: "image", permalink: "https://x/" }));
    expect((await apod("2001-02-04")).status).toBe(200);
  });

  it("asks again about today after 10 minutes: a miss may only mean it isn't posted yet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    nasaReplies(() => new Response("{}", { status: 404 }));
    expect((await apod("2026-10-01")).status).toBe(404);
    expect((await apod("2026-10-01")).status).toBe(404);
    expect(asked).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-01T12:10:01Z"));
    expect((await apod("2026-10-01")).status).toBe(404);
    expect(asked).toHaveLength(2);
  });
});

describe("the space cron route", () => {
  const call = (auth?: string) =>
    spaceCron(new Request("http://x/api/cron/space", auth ? { headers: { authorization: auth } } : {}));

  it("refuses everyone when no secret is set, and anyone without it", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "s3cret-value-for-tests");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-value-for-tests")).status).toBe(401);
    expect(pass).not.toHaveBeenCalled();
  });

  it("runs one pass of everything inside the route's time, and reports it with what's left", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-for-tests");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call("Bearer s3cret-value-for-tests");
    expect(res.status).toBe(200);
    // Hobby's 300 s with Fluid compute; it waits for a DONKI pass running
    // here inside the same 270, leaving 30 for a fetch that times out.
    expect(spaceCronModule.maxDuration).toBe(300);
    expect(pass).toHaveBeenCalledWith({ budgetMs: 270_000, wait: true });
    expect(await res.json()).toMatchObject({ fetches: 3, done: false, left: { epic: 4000 } });
    // Every source by name: one the pass didn't reach isn't read as nothing left.
    expect(log.mock.calls.flat().join(" ")).toMatch(
      /left: donki-gst not reached, donki-flr not reached, jpl-cad not reached, jpl-fireball not reached, apod not reached, sdo 12, epic 4000, epic-priority not reached$/,
    );
    log.mockRestore();
  });

  it("says so when another pass holds the fill", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value-for-tests");
    pass.mockResolvedValueOnce({ skipped: true, ms: 0, fetches: 0, wrote: [], failed: [], done: false, left: {}, heldUntil: "2026-10-03T09:36:00.000Z" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call("Bearer s3cret-value-for-tests");
    expect(await res.json()).toMatchObject({ skipped: true, heldUntil: "2026-10-03T09:36:00.000Z" });
    expect(log.mock.calls.flat().join(" ")).toBe("[retrospect] space pass skipped: another pass holds the fill until 2026-10-03T09:36:00.000Z");
    log.mockRestore();
  });
});

describe("the fill's progress (architect, 2 Oct 2026)", () => {
  it("shows what full passes wrote, readable in a browser, and says so when none has run", async () => {
    const empty = await progressRoute();
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toEqual({ updatedAt: null, left: {}, passes: [] });
    const p = { updatedAt: "2026-10-03T09:30:00.000Z", left: { epic: { count: 3800, at: "2026-10-03T09:30:00.000Z" } }, passes: [] };
    await writeSpaceJson(PROGRESS_KEY, p);
    expect(await (await progressRoute()).json()).toEqual(p);
  });
});
