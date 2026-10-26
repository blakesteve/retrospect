import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiquidNav } from "@blakesteve/roster";
import { describe, expect, it } from "vitest";
import { NextNavLink } from "@/components/listener/nextNavLink";

/* The view switcher's links (`NextNavLink`, the shell's LiquidNav). LiquidNav
   names a link that carries a count by its `aria-label` (Roster 5.13.0); a
   link component that drops it leaves the count to text hidden beside the
   label. No view has a count yet: the first to take one is named by it. */

/** The switcher drawn through `NextNavLink`, and each link's opening tag by its `href`. */
function links(count?: number) {
  const html = renderToStaticMarkup(
    createElement(LiquidNav, {
      "aria-label": "Views",
      activeTab: "tonight",
      linkComponent: NextNavLink,
      items: [
        { id: "tonight", label: "Tonight", href: "/u/sample" },
        { id: "nights", label: "Every night", href: "/u/sample/nights", count },
      ],
    }),
  );
  const tags = html.match(/<a\b[^>]*>/g) ?? [];
  return (href: string) => {
    const tag = tags.find((t) => t.includes(` href="${href}"`));
    expect(tag, href).toBeDefined();
    return tag!;
  };
}

describe("the view switcher's links", () => {
  it("carry the name LiquidNav gives a link with a count", () => {
    const link = links(3);
    expect(link("/u/sample/nights")).toContain('aria-label="Every night, 3 items"');
    expect(link("/u/sample")).not.toContain("aria-label=");
  });

  it("keep what they carried before, and never the router's `to`", () => {
    const link = links();
    expect(link("/u/sample")).toContain('aria-current="page"');
    expect(link("/u/sample")).toContain('data-tab-id="tonight"');
    expect(link("/u/sample/nights")).toContain('data-tab-id="nights"');
    expect(link("/u/sample/nights")).not.toContain("aria-current=");
    expect(link("/u/sample/nights")).not.toContain("aria-label=");
    expect(link("/u/sample/nights")).not.toContain(" to=");
  });
});
