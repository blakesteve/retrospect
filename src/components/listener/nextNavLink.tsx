"use client";

import NextLink from "next/link";
import type { LiquidNavLinkProps } from "@blakesteve/roster";

/**
 * `next/link` for LiquidNav, without the `to` it would pass through to the
 * `<a>`. Its `aria-label` goes on: LiquidNav names a link that carries a
 * count by it ("Every night, 3 items").
 */
export function NextNavLink(props: LiquidNavLinkProps) {
  const { href, className, children, onClick } = props;
  return (
    <NextLink
      href={href}
      className={className}
      onClick={onClick}
      aria-current={props["aria-current"]}
      aria-label={props["aria-label"]}
      data-tab-id={props["data-tab-id"]}
    >
      {children}
    </NextLink>
  );
}
