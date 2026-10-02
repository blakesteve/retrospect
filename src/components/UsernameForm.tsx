"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@blakesteve/roster";
import { isValidUsername } from "@/lib/username";

/**
 * `aria-invalid="true"` on a Roster `Input` (spec 8.1, 11). Roster's field is
 * Headless UI's, which sets `aria-invalid` from its own `invalid` prop and
 * overwrites one passed directly, so the prop that reaches it is `invalid`.
 * Roster's types don't list it; it rides through Roster's rest props.
 */
export const invalidProps = (invalid: boolean) => ({ invalid, "aria-invalid": invalid ? ("true" as const) : undefined });

/**
 * The username card (spec 8.1 item 6). The name is checked in the browser
 * with the status route's own pattern before anything is asked of the
 * server; a good one goes to `/u/{name}` with nothing else in the URL. There
 * is nothing to configure: the 12 questions are the same for everyone (4).
 */
export function UsernameForm() {
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // A page restored from the back-forward cache keeps its state: without
  // this, the button would still be loading when you come back.
  useEffect(() => {
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  return (
    <Card padding="none" className="sky-card mt-7 p-4 sm:p-5">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!isValidUsername(trimmed)) {
            setInvalid(true);
            field.current?.focus();
            return;
          }
          setSubmitting(true);
          router.push(`/u/${encodeURIComponent(trimmed)}`);
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <div className="min-w-0 flex-1">
          <Input
            ref={field}
            label="Your Last.fm username"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setInvalid(false);
            }}
            {...invalidProps(invalid)}
            errorMessage={invalid ? "That doesn't look like a Last.fm username." : undefined}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="go"
            variant="outline"
            size="lg"
          />
        </div>
        {/* Level with the field, under its 20px label, from 640px up. */}
        <Button type="submit" size="lg" isLoading={submitting} className="w-full sm:mt-5 sm:w-auto">
          Read my sky
        </Button>
      </form>
      <p className="mt-3 text-[13px] leading-snug text-ink-2">
        Public Last.fm profiles only. A big history takes a few minutes the first time.
      </p>
    </Card>
  );
}
