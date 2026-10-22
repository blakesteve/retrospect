import { inflateSync } from "node:zlib";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageResponse } from "next/og";
import { GET as shareCard } from "@/app/api/og/route";
import { cardFonts } from "@/app/api/og/cardFonts";
import { Card } from "@/app/api/og/cards";
import { MemoryBlobStore, setBlobStore } from "../store/blob";
import { CARD_SIZES, type CardSize } from "./card";

/* A long name on the share cards (ROADMAP Quality): on the generic card a
   name of about 25 characters with no space ran past the card's left edge,
   and the Moon off its right; on the others the name in the header line runs
   on past the right. Drawn with the app's own Satori (the generic card by the
   route itself) and read pixel by pixel: nothing brighter than the sky may
   land in the card's margins, at a name of 1, 25 and 50 characters (the most
   a name can have) of its widest letter. The generic card draws tonight's
   Moon, so the clock is held at a full Moon: near a new one the card has
   little ink of its own, and what's drawn mustn't depend on the date. */

/** The full Moon of April 13, 2025, 00:22 UTC. */
const FULL_MOON = Date.UTC(2025, 3, 13, 0, 22);

beforeEach(() => {
  setBlobStore(new MemoryBlobStore());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FULL_MOON);
});
afterEach(() => {
  vi.useRealTimers();
  setBlobStore(null);
});

/** A PNG's pixels, RGBA, as the card's renderer writes it (8 bits, color type 6). */
function decode(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const data: Uint8Array[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.slice(at + 4, at + 8));
    const body = png.slice(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      expect([body[8], body[9]], "8-bit RGBA").toEqual([8, 6]);
    }
    if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const corner = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      let out = v;
      if (filter === 1) out = v + left;
      else if (filter === 2) out = v + up;
      else if (filter === 3) out = v + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        out = v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
      }
      rgba[y * stride + x] = out & 0xff;
    }
  }
  return { width, height, rgba };
}

/** The card's padding (`Frame`): nothing is drawn in it but the sky. */
const PAD: Record<CardSize, { x: number; y: number }> = { wide: { x: 64, y: 52 }, tall: { x: 80, y: 96 } };

/** Pixels brighter than the sky (its gradient peaks near 37 of 255) in the
    margins, two pixels in from the padding's edge; and in the whole card. */
function ink(png: Uint8Array, size: CardSize) {
  const { width, height, rgba } = decode(png);
  const pad = PAD[size];
  let margins = 0;
  let drawn = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2] <= 70) continue;
      drawn++;
      if (x < pad.x - 2 || x >= width - pad.x + 2 || y < pad.y - 2 || y >= height - pad.y + 2) margins++;
    }
  return { width, height, margins, drawn };
}

/** Floors on what's drawn at the full Moon, measured 21 Oct 2026: a letter
    of the name drew at least 486 pixels on the wide card (at 44px) and 773
    on the tall (56px); the rest of the card, mostly the Moon, 53,796 and
    160,329, where a new Moon leaves about 15,600 and 27,900. */
const NAME_INK: Record<CardSize, number> = { wide: 300, tall: 500 };
const MOON_INK: Record<CardSize, number> = { wide: 40_000, tall: 120_000 };

/** The generic card for a name, as the route draws it. */
async function generic(name: string, size: CardSize) {
  const res = await shareCard(new Request(`http://x/api/og?u=${name}${size === "tall" ? "&size=tall" : ""}`));
  expect(res.status).toBe(200);
  return ink(new Uint8Array(await res.arrayBuffer()), size);
}

describe("a long name on the share cards (ROADMAP Quality, spec 8.7.5)", () => {
  for (const size of ["wide", "tall"] as const)
    for (const n of [1, 25, 50]) {
      it(`keeps a ${n}-character name, and the Moon, inside the ${size} card`, async () => {
        const seen = await generic("W".repeat(n), size);
        expect([seen.width, seen.height]).toEqual([CARD_SIZES[size].width, CARD_SIZES[size].height]);
        expect(seen.margins).toBe(0);
        // The same card with the name in periods, the same length, set the
        // same size: the difference is the name's own ink, so a name clipped
        // or dropped can't pass; and the rest, mostly the full Moon, is drawn.
        const dots = await generic(".".repeat(n), size);
        expect(seen.drawn - dots.drawn, "the name's ink").toBeGreaterThan(n * NAME_INK[size]);
        expect(dots.drawn, "the Moon and the card's words").toBeGreaterThan(MOON_INK[size]);
      });
    }

  for (const size of ["wide", "tall"] as const)
    it(`ends a 50-character name in the header of a question's ${size} card rather than run off it`, async () => {
      const data = { kind: "q" as const, username: "W".repeat(50), says: "Did a full moon move me?", question: "Do I listen differently under a full moon?", word: "No", line: null };
      const res = new ImageResponse(createElement(Card, { data, size }), { ...CARD_SIZES[size], fonts: cardFonts() });
      const seen = ink(new Uint8Array(await res.arrayBuffer()), size);
      expect(seen.drawn).toBeGreaterThan(20_000);
      expect(seen.margins).toBe(0);
    });

  it("finds ink in the margins when there is some: a name pushed past the left edge", async () => {
    const res = new ImageResponse(
      createElement(
        "div",
        { style: { width: "100%", height: "100%", display: "flex", backgroundColor: "#0b1026", padding: "52px 64px", alignItems: "center" } },
        createElement("div", { style: { display: "flex", fontSize: 72, color: "#f2efe6", marginLeft: -120 } }, "W".repeat(25)),
      ),
      { ...CARD_SIZES.wide, fonts: cardFonts() },
    );
    expect(ink(new Uint8Array(await res.arrayBuffer()), "wide").margins).toBeGreaterThan(500);
  });
});
