import type { Scrobble } from "@/lib/analysis/nostalgia";
import type { NasaLog } from "@/lib/space/compact";
import { takeBackIfRemoved } from "@/lib/removal";
import { getBlobStore } from "@/lib/store/blob";
import { userKey } from "@/lib/store/userKeys";
import { ANSWERS_VERSION, computeAnswers, historyStamp, type AnswerRecord } from "./engine";

/**
 * Stored answers (spec 6.6): one record per listener and zone, holding the
 * answers, the history stamp, the NASA stamp and the analysis version. The
 * records for one listener share one blob, `answers/{name}.json`, so removal,
 * expiry and the audit find them through `userKeys.ts` like every other
 * per-listener key. Most listeners use one zone; a shared link in another
 * zone adds one. The most recent few are kept.
 */

/** Zones kept per listener, the most recently computed first. */
export const MAX_ZONES = 4;

interface StoredAnswers {
  records: AnswerRecord[];
}

const keyOf = (username: string) => userKey("answers", username);

async function readAll(username: string): Promise<AnswerRecord[]> {
  const raw = await getBlobStore().get(keyOf(username));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as StoredAnswers;
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

export async function readAnswers(username: string, zone: string): Promise<AnswerRecord | null> {
  return (await readAll(username)).find((r) => r.zone === zone) ?? null;
}

/** A record missing a question that threw is retried, but not more often
    than this: a question that throws every time would otherwise recompute
    and rewrite on every request. */
export const RETRY_INCOMPLETE_MS = 60 * 60 * 1000;

/**
 * Whether a stored record still answers for this history. Behind on the
 * history, the NASA log or the analysis version, or missing a question that
 * threw an hour or more ago: it's served, and recomputed in the background
 * (6.6).
 */
export function isCurrent(
  record: AnswerRecord,
  stored: Scrobble[],
  nasaStamp: string | null = null,
  now = Date.now(),
): boolean {
  return (
    record.version === ANSWERS_VERSION &&
    record.stamp === historyStamp(stored) &&
    record.nasaStamp === nasaStamp &&
    (!record.incomplete || now - record.computedAt < RETRY_INCOMPLETE_MS)
  );
}

/* Writes for one name, one at a time in this process: two zones computed at
   once would otherwise each read the blob, and the second write would drop
   the first zone. */
const writing = new Map<string, Promise<unknown>>();
function oneAtATime<T>(username: string, job: () => Promise<T>): Promise<T> {
  const key = username.toLowerCase();
  const next = (writing.get(key) ?? Promise.resolve()).then(job, job);
  writing.set(key, next);
  void next.finally(() => {
    if (writing.get(key) === next) writing.delete(key);
  });
  return next;
}

/**
 * Compute and store one zone's answers. `startedAt` is when the request began,
 * before it read the history: if the name was removed since then, the write
 * is taken back (`takeBackIfRemoved`). Returns the record either way, for the
 * request that asked.
 */
export async function computeAndStore(
  username: string,
  zone: string,
  stored: Scrobble[],
  startedAt: number,
  nasa: NasaLog | null = null,
): Promise<AnswerRecord> {
  const record = computeAnswers(username, stored, zone, Date.now(), nasa);
  await oneAtATime(username, async () => {
    const others = (await readAll(username)).filter((r) => r.zone !== zone);
    const records = [record, ...others].slice(0, MAX_ZONES);
    await getBlobStore().put(keyOf(username), Buffer.from(JSON.stringify({ records } satisfies StoredAnswers)));
    await takeBackIfRemoved(username, startedAt, [keyOf(username)]);
  });
  return record;
}

/* One computation per listener, zone, history and NASA log at a time in this
   process: a second request for the same inputs waits for the first instead of
   starting over. One that has seen newer plays, or a newer log, starts its own. */
const running = new Map<string, Promise<AnswerRecord>>();

export function computeOnce(
  username: string,
  zone: string,
  stored: Scrobble[],
  startedAt: number,
  nasa: NasaLog | null = null,
): Promise<AnswerRecord> {
  const key = `${username.toLowerCase()}|${zone}|${historyStamp(stored)}|${nasa?.stamp ?? ""}`;
  let job = running.get(key);
  if (!job) {
    job = computeAndStore(username, zone, stored, startedAt, nasa).finally(() => running.delete(key));
    running.set(key, job);
  }
  return job;
}
