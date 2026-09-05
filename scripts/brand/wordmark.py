"""Derive the 'mate' wordmark outlines for the lockup, in the mark's own units.

Sora SemiBold (wght 600), lowercase, letter-spacing -0.015 em, shaped with
HarfBuzz (kern on). Scaled so the x-height equals the window height (34.13),
baseline on the window floor (y = 42.75), first stem two strokes (2 x 7.9)
right of the mark's right edge (x = 42.74).
"""
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import uharfbuzz as hb, json

vf = TTFont("Sora-VF.ttf")
static = instancer.instantiateVariableFont(vf, {"wght": 600})
static.save("Sora-600.ttf")
ttf = TTFont("Sora-600.ttf")
upem = ttf["head"].unitsPerEm
xh = ttf["OS/2"].sxHeight
gs = ttf.getGlyphSet(); order = ttf.getGlyphOrder()

face = hb.Face(open("Sora-600.ttf", "rb").read()); font = hb.Font(face)
buf = hb.Buffer(); buf.add_str("mate"); buf.guess_segment_properties()
hb.shape(font, buf, {"kern": True, "liga": True})

WINDOW_H, STROKE, MARK_RIGHT, FLOOR = 34.13, 7.9, 42.74, 42.75
scale = WINDOW_H / xh
tracking = -0.015 * upem
x0 = MARK_RIGHT + 2 * STROKE
pen_x = 0.0; glyphs = []; ink_right = 0.0; ink_top = 99.0
fmt = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")
for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
    name = order[info.codepoint]
    gx = pen_x + pos.x_offset; gy = pos.y_offset
    tf = (scale, 0, 0, -scale, x0 + gx * scale, FLOOR - gy * scale)
    spen = SVGPathPen(gs, ntos=fmt); gs[name].draw(TransformPen(spen, tf))
    bpen = BoundsPen(gs); gs[name].draw(TransformPen(bpen, tf))
    glyphs.append({"glyph": name, "d": spen.getCommands(), "bounds": [round(b, 2) for b in bpen.bounds]})
    ink_right = max(ink_right, bpen.bounds[2]); ink_top = min(ink_top, bpen.bounds[1])
    pen_x += pos.x_advance + (tracking if i < len(buf.glyph_infos) - 1 else 0)
print(json.dumps({"upem": upem, "xHeight": xh, "scale": round(scale, 5), "x0": round(x0, 2),
                  "advanceRight": round(x0 + pen_x * scale, 2), "inkRight": round(ink_right, 2),
                  "inkTop": round(ink_top, 2), "glyphs": [{k: v for k, v in g.items() if k != "d"} for g in glyphs]}, indent=1))
json.dump(glyphs, open("wordmark.json", "w"), indent=1)
print("path lengths", [len(g["d"]) for g in glyphs])
