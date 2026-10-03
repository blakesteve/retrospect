"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useListener } from "./Shell";
import type { SheetRef } from "./sheetUrl";

/** A link that opens a sheet: a real `href` (so it can open in a new tab),
    a pushState on a plain click (4). */
export function SheetLink({
  to,
  children,
  className = "",
  lead,
  ...rest
}: {
  to: SheetRef;
  children: ReactNode;
  className?: string;
  lead?: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick" | "children" | "className">) {
  const L = useListener();
  // Keeps a shared `tz` in force, as the view switcher does (7.1).
  const tz = useSearchParams().get("tz");
  const href = `?${tz ? `tz=${encodeURIComponent(tz)}&` : ""}${to.kind}=${encodeURIComponent(to.value)}`;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    L.open(to, lead);
  };
  return (
    <a href={href} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  );
}
