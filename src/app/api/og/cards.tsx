import type { ReactNode } from "react";
import { moonLit } from "@/lib/client/moon";
import { cardGlyph } from "@/lib/sky/glyphs";
import type { CardData } from "@/lib/share/cardData";
import type { CardSize } from "@/lib/share/card";
import { CARD_SYMBOLS, CARD_TEXT } from "./cardFonts";

/* The share cards' drawings (spec 8.7.5), for Satori: every box is a flex
   box, and the glyphs come from the cards' own font at Private Use code
   points (`cardGlyph`), never an emoji (8.9). Plain words first; the sky is
   drawn from its numbers. */

const SKY = "#0b1026";
const INK = "#f2efe6";
const INK_2 = "#b9b6ab";
const GOLD = "#d4af37";
const LINE = "rgba(212,175,55,0.35)";

const PLANET_NAMES: Record<string, string> = {
  Sun: "The Sun",
  Moon: "The Moon",
  Mercury: "Mercury",
  Venus: "Venus",
  Mars: "Mars",
  Jupiter: "Jupiter",
  Saturn: "Saturn",
};

/** The Moon, drawn from her phase angle as the app draws her (8.9). */
function Moon({ phase, size }: { phase: number; size: number }) {
  const r = size / 2 - 2;
  const lit = moonLit(phase, size / 2, r);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="#1b2046" stroke="rgba(242,239,230,0.3)" strokeWidth={2} />
      {lit === "full" ? <circle cx={size / 2} cy={size / 2} r={r} fill="#f4efd9" /> : lit !== "none" ? <path d={lit} fill="#f4efd9" /> : null}
    </svg>
  );
}

const Glyph = ({ children, size, color = INK }: { children: string; size: number; color?: string }) => (
  <span style={{ fontFamily: CARD_SYMBOLS, fontSize: size, color, lineHeight: 1 }}>{children}</span>
);

function Frame({ size, username, children }: { size: CardSize; username: string | null; children: ReactNode }) {
  const tall = size === "tall";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: SKY,
        backgroundImage: "radial-gradient(circle at 50% 0%, #1c2350 0%, #0b1026 70%)",
        color: INK,
        fontFamily: CARD_TEXT,
        padding: tall ? "96px 80px" : "52px 64px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: tall ? 30 : 22,
          paddingBottom: tall ? 28 : 18,
          borderBottom: `2px solid ${LINE}`,
        }}
      >
        <span style={{ color: GOLD, letterSpacing: tall ? 10 : 7 }}>RETROSPECT</span>
        {username && <span style={{ color: INK_2 }}>{username}</span>}
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: tall ? "column" : "row", alignItems: "center", justifyContent: "center", gap: tall ? 72 : 56 }}>
        {children}
      </div>
      <div style={{ display: "flex", fontSize: tall ? 26 : 20, color: INK_2 }}>The sky of your Last.fm history · retrospect</div>
    </div>
  );
}

function Says({ text, size }: { text: string; size: CardSize }) {
  const tall = size === "tall";
  const long = text.length > 90;
  return (
    <div
      style={{
        display: "flex",
        fontSize: tall ? (long ? 58 : 66) : long ? 38 : 46,
        lineHeight: 1.25,
        maxWidth: tall ? 920 : 700,
        textAlign: tall ? "center" : "left",
      }}
    >
      {text}
    </div>
  );
}

export function Card({ data, size }: { data: CardData; size: CardSize }) {
  const tall = size === "tall";
  switch (data.kind) {
    case "song":
      return (
        <Frame size={size} username={data.username}>
          <Says text={data.says} size={size} />
          <div style={{ display: "flex", flexDirection: "column", gap: tall ? 18 : 6 }}>
            {data.planets.map((p) => (
              <div key={p.body} style={{ display: "flex", alignItems: "center", gap: tall ? 20 : 12, fontSize: tall ? 40 : 24, color: INK_2 }}>
                <Glyph size={tall ? 56 : 30} color={p.body === "Sun" ? "#ffe39a" : INK}>
                  {cardGlyph(p.body)}
                </Glyph>
                {tall ? <span>{`${PLANET_NAMES[p.body]} in ${p.sign}${p.retrograde ? ", retrograde" : ""}`}</span> : <span>{p.sign}</span>}
                <Glyph size={tall ? 48 : 26} color={GOLD}>
                  {cardGlyph(p.sign)}
                </Glyph>
              </div>
            ))}
          </div>
        </Frame>
      );
    case "night":
      return (
        <Frame size={size} username={data.username}>
          <div style={{ display: "flex", flexDirection: "column", gap: tall ? 36 : 22, alignItems: tall ? "center" : "flex-start" }}>
            <Says text={data.says} size={size} />
            <div style={{ display: "flex", fontSize: tall ? 40 : 26, color: INK_2 }}>
              {`${data.plays.toLocaleString("en-US")} ${data.plays === 1 ? "play" : "plays"}${data.usual !== null ? ` · a usual ${data.weekday} is ${data.usual.toLocaleString("en-US")}` : ""}`}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <Moon phase={data.moonPhase} size={tall ? 420 : 230} />
            <span style={{ fontSize: tall ? 34 : 22, color: INK_2 }}>{`${data.moonName} at 9 p.m.`}</span>
          </div>
        </Frame>
      );
    case "q":
      return (
        <Frame size={size} username={data.username}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: tall ? "center" : "flex-start", gap: tall ? 48 : 18 }}>
            <div style={{ display: "flex", fontSize: tall ? 64 : 44, lineHeight: 1.25, maxWidth: tall ? 920 : 1040, textAlign: tall ? "center" : "left" }}>
              {data.question}
            </div>
            <div style={{ display: "flex", fontSize: tall ? 190 : 112, color: GOLD, lineHeight: 1 }}>{data.word}</div>
            {data.line && (
              <div style={{ display: "flex", fontSize: tall ? 40 : 28, color: INK_2, maxWidth: tall ? 900 : 1040, textAlign: tall ? "center" : "left" }}>
                {data.line}
              </div>
            )}
          </div>
        </Frame>
      );
    case "generic":
      return (
        <Frame size={size} username={null}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: tall ? "center" : "flex-start", gap: tall ? 28 : 16 }}>
            <div style={{ display: "flex", fontSize: tall ? 96 : 72, lineHeight: 1.1 }}>{data.username ?? "Retrospect"}</div>
            <div style={{ display: "flex", fontSize: tall ? 40 : 28, color: INK_2, maxWidth: tall ? 900 : 640, textAlign: tall ? "center" : "left" }}>
              {data.username
                ? "Their Last.fm history under the real sky, and an honest answer to whether any of it moved them."
                : "Your Last.fm history under the real sky."}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <Moon phase={data.moonPhase} size={tall ? 420 : 230} />
            <span style={{ fontSize: tall ? 34 : 22, color: INK_2 }}>{`Tonight: ${data.moonName.toLowerCase()}`}</span>
          </div>
        </Frame>
      );
  }
}
