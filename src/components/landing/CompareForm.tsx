"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@blakesteve/roster";
import { isValidUsername } from "@/lib/username";
import { invalidProps } from "@/components/UsernameForm";

/* "Compare two listeners" (spec 8.1 item 7): a quiet link that opens the
   compare form, two names and "Compare", going to `/vs/{a}/{b}` (8.8). */

const NOT_A_NAME = "That doesn't look like a Last.fm username.";
const SAME = "That's the same listener twice.";

export function CompareForm() {
  const router = useRouter();
  const first = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [errors, setErrors] = useState<{ a?: string; b?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  useEffect(() => {
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  const field = { variant: "outline", size: "lg", autoCapitalize: "none", autoCorrect: "off", spellCheck: false, autoComplete: "off" } as const;

  return (
    <div className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="compare-form"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center text-[15px] text-ink-2 underline underline-offset-4 hover:text-gold"
      >
        Compare two listeners
      </button>
      <form
        id="compare-form"
        hidden={!open}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const ua = a.trim();
          const ub = b.trim();
          const next = {
            a: isValidUsername(ua) ? undefined : NOT_A_NAME,
            b: !isValidUsername(ub) ? NOT_A_NAME : ua.toLowerCase() === ub.toLowerCase() ? SAME : undefined,
          };
          setErrors(next);
          if (next.a || next.b) return;
          setSubmitting(true);
          router.push(`/vs/${encodeURIComponent(ua)}/${encodeURIComponent(ub)}`);
        }}
        className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <div className="min-w-0 flex-1">
          <Input
            ref={first}
            label="First Last.fm username"
            value={a}
            onChange={(e) => {
              setA(e.target.value);
              setErrors((x) => ({ ...x, a: undefined }));
            }}
            {...invalidProps(Boolean(errors.a))}
            errorMessage={errors.a}
            {...field}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Input
            label="Second Last.fm username"
            value={b}
            onChange={(e) => {
              setB(e.target.value);
              setErrors((x) => ({ ...x, b: undefined }));
            }}
            {...invalidProps(Boolean(errors.b))}
            errorMessage={errors.b}
            {...field}
          />
        </div>
        <Button type="submit" size="lg" variant="outline" isLoading={submitting} className="w-full sm:mt-5 sm:w-auto">
          Compare
        </Button>
      </form>
    </div>
  );
}
