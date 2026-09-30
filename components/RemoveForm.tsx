"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Input } from "@blakesteve/roster";
import { isValidUsername } from "@/lib/username";
import { removalMessage, toRemovalOutcome, type RemovalOutcomeCode } from "@/lib/removalCopy";

const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });

/**
 * Type a username, press Remove. Typing the name is the confirmation: the
 * field never starts filled in, even when the report page sent the name along
 * (`?u=`), which only shows up as a hint. The request is a POST that repeats
 * the name (see the route).
 */
export function RemoveForm() {
  const hint = useSearchParams().get("u")?.trim() ?? "";
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    outcome: RemovalOutcomeCode;
    name: string;
    when?: string;
  } | null>(null);

  const name = typed.trim();
  const showHint = hint !== "" && isValidUsername(hint);

  async function remove() {
    if (sending) return;
    /* Checked here rather than by disabling the button: a disabled button
       can't be focused and doesn't say why it's off. */
    if (!isValidUsername(name)) {
      setResult({ outcome: "invalid", name });
      return;
    }
    setResult(null);
    setSending(true);
    try {
      const res = await fetch(`/api/user/${encodeURIComponent(name)}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) console.error("[retrospect] removal refused:", res.status, body);
      const outcome = toRemovalOutcome(body?.outcome);
      setResult({
        outcome,
        name,
        when: typeof body?.retryAt === "number" ? fmtWhen(body.retryAt) : undefined,
      });
      if (outcome === "removed" || outcome === "nothing-stored") setTyped("");
    } catch (err) {
      console.error("[retrospect] removal failed:", err);
      setResult({ outcome: "network", name });
    } finally {
      setSending(false);
    }
  }

  const message = result ? removalMessage(result.outcome, result.name, result.when) : null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        remove();
      }}
    >
      {/* Same pairing as the landing form, with `items-end` rather than center
          because the label sits above this field and the button should line
          up with the box, not the label. `lg` on both is the height match.
          The hint is the label itself, not `helperText` (text under the box
          moves its bottom edge off the button's) and not a paragraph tied on
          with `aria-describedby` (Roster's Input drops that prop: Headless UI's
          Field sets its own). */}
      <div className="flex w-full items-end gap-3">
        <Input
          label={showHint ? `Type ${hint} to remove that history` : "Last.fm username"}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          variant="outline"
          size="lg"
          className="flex-1"
          inputClassName="placeholder:text-ink-3"
        />
        {/* No `isLoading` either: Roster makes it `disabled`, which drops
            focus mid-press. */}
        <Button type="submit" colorScheme="error" variant="solid" size="lg">
          {sending ? "Removing\u2026" : "Remove"}
        </Button>
      </div>
      <div role="status" aria-live="polite">
        {message && (
          <div className="border-l-2 border-gold pl-4">
            <p className="text-ink">{message.title}</p>
            <p className="text-ink-2 text-sm mt-1">{message.body}</p>
          </div>
        )}
      </div>
    </form>
  );
}
