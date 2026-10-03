"use client";

import { useEffect } from "react";
import type { SheetBodyProps } from "@/components/listener/SheetHost";
import { QuestionsGrid } from "@/components/listener/shared";

/* The 12 answers tile's sample (spec 8.1): the sample listener's questions,
   each opening its own sheet. */

export default function AnswersSample({ setBusy }: SheetBodyProps) {
  useEffect(() => setBusy(false), [setBusy]);
  // The grid is a row of Tonight, spaced for a page; a sheet starts at its top.
  return (
    <div className="pb-4 [&_section]:mt-0">
      <QuestionsGrid />
    </div>
  );
}
