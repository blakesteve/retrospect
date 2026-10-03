"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@blakesteve/roster";
import { isValidUsername } from "@/lib/username";
import { useListener } from "./Shell";
import { SheetLink } from "./sheetLink";
import { AnswerPill, Row, RowFailed } from "./pieces";

/* The rows both views end with (8.4 items 5 and 6, 8.5 item 6): "Does the
   sky move you?" and "Compare with a friend". Their own module, so Every
   night doesn't load Tonight to show them. */

export function QuestionsGrid({ level = 2 }: { level?: 2 | 3 }) {
  const L = useListener();
  const a = L.answers.state === "ready" ? L.answers.data : null;
  const answers = a && a.status !== "computing" ? a : null;
  return (
    <section id="questions-grid">
      <Row id="questions" title="Does the sky move you?" level={level}>
        {L.answers.state === "failed" ? (
          <RowFailed name="The 12 questions" />
        ) : !answers ? (
          // The one announced progress line on Tonight (8.4, 11).
          <p className="text-ink-2" role="status">
            Checking 12 questions against your sky&hellip; {a?.done ?? 0} of 12
          </p>
        ) : (
          // No fluke meter on the tiles: unlabeled, it read backwards (8.9).
          <ul className="grid grid-cols-3 gap-2.5">
            {answers.questions.map((q) => (
              <li key={q.id}>
                <SheetLink to={{ kind: "q", value: q.id }} className="group block h-full rounded-[18px]">
                  <Card
                    padding="none"
                    className="sky-card flex h-full flex-col gap-1.5 p-2.5 transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none"
                  >
                    <span className="text-[11px] text-ink-2">
                      <span className="sr-only">Question </span>
                      {q.number}
                      <span className="sr-only">:</span>
                    </span>
                    <span className="min-h-[2.5em] text-[12.5px] leading-tight text-ink">{q.shortName}</span>
                    <AnswerPill word={q.word} className="self-start !px-2 !text-[12px]" />
                  </Card>
                </SheetLink>
              </li>
            ))}
          </ul>
        )}
      </Row>
    </section>
  );
}

export function CompareCard() {
  const L = useListener();
  const router = useRouter();
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = other.trim();
    if (!isValidUsername(name)) {
      setError("That doesn't look like a Last.fm username.");
      return;
    }
    if (name.toLowerCase() === L.username.toLowerCase()) {
      setError("That's the same listener twice.");
      return;
    }
    router.push(`/vs/${encodeURIComponent(L.username)}/${encodeURIComponent(name)}`);
  };
  return (
    <Row id="compare" title="Compare with a friend">
      <Card padding="none" className="sky-card p-4">
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              size="lg"
              variant="outline"
              label="Their Last.fm username"
              value={other}
              onChange={(e) => {
                setOther(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              errorMessage={error ?? undefined}
              autoComplete="off"
            />
          </div>
          <Button size="lg" type="submit">
            Compare
          </Button>
        </form>
      </Card>
    </Row>
  );
}
