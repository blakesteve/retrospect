"""Cut the Sky wheels' own glyph font, public/fonts/retrospect-sky-glyphs.woff2,
and print each glyph's least circle for orbitGlyphs.ts's INK and MARK.

The seven planets and the prescription sign (U+211E, the retrograde mark),
so the wheels draw the same ink on every machine and the layout's circles
fit it. Apple Symbols, the first font the wheels named before, isn't on
Linux, Android or Windows, and CI's Linux fallback drew a mark into Mercury.

Sources, all under the SIL Open Font License 1.1, with no Reserved Font
Name, from notofonts.github.io (downloaded 17 Oct 2026):

  NotoSansSymbols-Regular.ttf   2.003  the Moon, Mercury, Venus, Mars, Jupiter, Saturn
    symbols/fonts/NotoSansSymbols/hinted/ttf/
    sha256 3f98aca41f54a721c9c06d4dfa47d6d84b4a49e116211a29bafcae8f7e292b8a
  NotoSansSymbols2-Regular.ttf  2.008  the Sun
    symbols/fonts/NotoSansSymbols2/hinted/ttf/
    sha256 207bd630c4bdac399099afa80986ef5dfbee3c35a47cab04c4a7ee94fcbd5bec
  NotoSans-Regular.ttf          2.015  the prescription sign (neither Symbols font has it)
    latin-greek-cyrillic/fonts/NotoSans/hinted/ttf/
    sha256 141494de430d4f68e13c91138e10ae755909de8f5ff274db6f17becd393a2898

The share cards' glyphs come from the same two Symbols fonts
(src/app/api/og/cardFonts.ts). Merged and renamed "Retrospect Sky Glyphs";
the name table keeps each source's copyright notice and the license.

    python3 -m venv venv && venv/bin/pip install fonttools==4.57.0 brotli==1.2.0
    venv/bin/python scripts/sky-glyph-font.py Symbols.ttf Symbols2.ttf Sans.ttf out.woff2

Made 17 Oct 2026, the same bytes every run: 1,488, sha256
d814a448abbf12efb4e61b1f13601a294e2e930ed3979bfe86c288d3ff3bea86.
"""

import math
import os
import sys
import tempfile

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

PARTS = [
    [0x263D, 0x263F, 0x2640, 0x2642, 0x2643, 0x2644],
    [0x2609],
    [0x211E],
]
# Each glyph as the wheels draw it: its size and its outline's width.
DRAWN = {
    "Sun": (0x2609, 26, 4.5),
    "Moon": (0x263D, 26, 4.5),
    "Mercury": (0x263F, 21, 4.5),
    "Venus": (0x2640, 21, 4.5),
    "Mars": (0x2642, 21, 4.5),
    "Jupiter": (0x2643, 21, 4.5),
    "Saturn": (0x2644, 21, 4.5),
    "mark": (0x211E, 16, 3),
}


def cut(path, codes, out):
    opts = subset.Options()
    opts.hinting = False
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.layout_features = []
    opts.notdef_outline = True
    opts.glyph_names = False
    # Horizontal text only, and no tables the three would have to agree on to merge.
    opts.drop_tables += ["GSUB", "GPOS", "GDEF", "MATH", "BASE", "JSTF", "DSIG", "vhea", "vmtx", "STAT", "gasp"]
    font = TTFont(path, recalcTimestamp=False)
    s = subset.Subsetter(opts)
    s.populate(unicodes=codes)
    s.subset(font)
    font.save(out)


def circles(font):
    """Each glyph's least circle around its outline points (which bound its
    curves) plus half its outline, in shares of its size, its center from
    where the wheel anchors it: x from the middle of its advance, y down,
    the baseline .35em below."""
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyf = font["glyf"]
    out = {}
    for body, (code, size, stroke) in DRAWN.items():
        name = cmap[code]
        adv = font["hmtx"][name][0]
        coords, _, _ = glyf[name].getCoordinates(glyf)
        pts = [((x - adv / 2) / upm, 0.35 - y / upm) for x, y in coords]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        cx0, cy0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        best = None
        for i in range(-150, 151):
            for j in range(-150, 151):
                cx, cy = cx0 + i * 0.001, cy0 + j * 0.001
                r = max(math.hypot(x - cx, y - cy) for x, y in pts)
                if best is None or r < best[2]:
                    best = (cx, cy, r)
        cx, cy, r = best
        out[body] = (round(cx, 3), round(cy, 3), math.ceil((r + (stroke / 2) / size) * 1000) / 1000)
    return out


def main():
    symbols, symbols2, sans, out = sys.argv[1:5]
    with tempfile.TemporaryDirectory() as work:
        cuts = []
        for path, codes in zip((symbols, symbols2, sans), PARTS):
            p = os.path.join(work, f"part{len(cuts)}.ttf")
            cut(path, codes, p)
            cuts.append(p)
        merged = Merger().merge(cuts)
    for rec in merged["name"].names:
        if rec.nameID in (1, 4, 16):
            rec.string = "Retrospect Sky Glyphs"
        elif rec.nameID == 6:
            rec.string = "RetrospectSkyGlyphs-Regular"
        elif rec.nameID == 3:
            rec.string = "Retrospect Sky Glyphs Regular"
        elif rec.nameID == 0:
            # Each source's notice: the two Symbols fonts share one.
            rec.string = (
                "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/symbols); "
                "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)"
            )
        elif rec.nameID == 5:
            rec.string = "Version 1.000; from Noto Sans Symbols 2.003, Noto Sans Symbols 2 2.008 and Noto Sans 2.015"
    # The same bytes from the same sources: the first source's dates, not today's.
    source = TTFont(symbols)["head"]
    merged["head"].created = source.created
    merged["head"].modified = source.modified
    merged.recalcTimestamp = False
    merged.flavor = "woff2"
    merged.save(out)
    print(out, os.path.getsize(out), "bytes")
    for body, (cx, cy, reach) in circles(TTFont(out)).items():
        print(f"  {body}: {{ cx: {cx}, cy: {cy}, reach: {reach} }}")


if __name__ == "__main__":
    main()
