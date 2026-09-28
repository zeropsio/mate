import {
  MATE_FACE,
  MATE_SHAPE_OF_TINT,
  MATE_SHAPES,
  MATE_TINT_IDS,
  mateFaceParts,
  type MateMarkState,
} from "@t3tools/shared/brand";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MateFace } from "./MateFace";

/** The attributes of every element a face draws, keyed by the part it plays. */
function parts(html: string) {
  const attrs = (tag: string) =>
    [...html.matchAll(new RegExp(`<${tag} ([^>]*?)/?>`, "gu"))].map((match) =>
      Object.fromEntries(
        [...match[1]!.matchAll(/([\w-]+)="([^"]*)"/gu)].map(([, key, value]) => [key, value]),
      ),
    );
  return {
    eyes: attrs("rect").filter((eye) => "data-mate-face-eye" in eye),
    shut: attrs("line").filter((line) => "data-mate-face-shut" in line),
    arcs: attrs("path").filter((path) => "data-mate-face-arc" in path),
    o: attrs("circle").find((circle) => circle["data-mate-face-mouth"] === "o")!,
    smile: attrs("path").find((path) => path["data-mate-face-mouth"] === "smile")!,
  };
}

describe("MateFace", () => {
  it.each(MATE_TINT_IDS)("draws %s as its own shape, from its palette token", (tint) => {
    const html = renderToStaticMarkup(<MateFace state="idle" tint={tint} />);
    const shape = MATE_SHAPE_OF_TINT[tint];
    expect(html).toContain(`data-mate-face-tint="${tint}"`);
    expect(html).toContain(`data-mate-face-shape="${shape}"`);
    expect(html).toContain(`fill-[var(--zerops-mate-tint-${tint})]`);
    expect(html).toContain(`d="${MATE_SHAPES[shape].d}"`);
    // It turns about its own centre, a notch of its own symmetry.
    expect(html).toContain(`--mate-face-step:${MATE_SHAPES[shape].step}deg`);
    expect(html).toContain(
      `--mate-face-origin:${MATE_SHAPES[shape].origin[0]}px ${MATE_SHAPES[shape].origin[1]}px`,
    );
    // The eyes are ink from the palette, never a literal.
    expect(html).toContain("fill-[var(--zerops-mate-face-ink)]");
    expect(html).not.toMatch(/#[0-9a-f]{6}/iu);
  });

  it("is decorative: the name and the word beside it carry the meaning", () => {
    const html = renderToStaticMarkup(<MateFace state="idle" tint="coral" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
    expect(html).toContain('data-zerops-primitive="mate-face"');
  });

  it.each<MateMarkState>(["idle", "working", "needs", "done", "sleep"])(
    "draws %s with the one drawing, so a change of state morphs",
    (state) => {
      const face = parts(renderToStaticMarkup(<MateFace state={state} tint="sky" />));
      expect(face.eyes).toHaveLength(2);
      expect(face.shut).toHaveLength(2);
      expect(face.arcs).toHaveLength(2);
      expect(face.o).toBeDefined();
      expect(face.smile).toBeDefined();
    },
  );

  it("wears open pills when idle, and the same pills narrowed when working", () => {
    const idle = parts(renderToStaticMarkup(<MateFace state="idle" tint="sky" />));
    const working = parts(renderToStaticMarkup(<MateFace state="working" tint="sky" />));
    const [open] = mateFaceParts("idle").eyes;
    const [narrowed] = mateFaceParts("working").eyes;
    expect(idle.eyes.map((eye) => [eye.height, eye.opacity])).toEqual([
      [String(open!.height), "1"],
      [String(open!.height), "1"],
    ]);
    expect(working.eyes.map((eye) => [eye.height, eye.y])).toEqual([
      [String(narrowed!.height), String(narrowed!.y)],
      [String(narrowed!.height), String(narrowed!.y)],
    ]);
    for (const face of [idle, working]) {
      expect(face.o.opacity).toBe("0");
      expect(face.smile.opacity).toBe("0");
      expect(face.arcs.map((arc) => arc.opacity)).toEqual(["0", "0"]);
    }
  });

  it("opens an o when it needs you", () => {
    const html = renderToStaticMarkup(<MateFace state="needs" tint="amber" />);
    const face = parts(html);
    expect(face.o).toMatchObject({
      cy: String(MATE_FACE.mouth.y),
      r: String(MATE_FACE.mouth.r),
      opacity: "1",
    });
    expect(html).toContain('data-mate-face-state="needs"');
  });

  it("smiles with its arcs when done, its pills closed to a slit where they stand", () => {
    const face = parts(renderToStaticMarkup(<MateFace state="done" tint="olive" />));
    expect(face.arcs.map((arc) => arc.opacity)).toEqual(["1", "1"]);
    expect(face.smile.opacity).toBe("1");
    expect(face.eyes.map((eye) => eye.opacity)).toEqual(["0", "0"]);
    expect(face.o.r).toBe("0");
  });

  it("shuts its eyes as hairlines that survive a 14 px face", () => {
    const html = renderToStaticMarkup(<MateFace size="dot" state="sleep" tint="rose" />);
    const face = parts(html);
    expect(face.shut.map((line) => line.opacity)).toEqual(["1", "1"]);
    expect(face.eyes.map((eye) => eye.opacity)).toEqual(["0", "0"]);
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).toContain('stroke-width="1.25"');
    expect(html).toContain("size-3.5");
  });

  it("marks no arrival on a first paint: a reload shows the state, not the arriving at it", () => {
    const html = renderToStaticMarkup(<MateFace state="done" tint="violet" />);
    expect(html).not.toContain("data-mate-face-arrived");
  });

  it("looks where the status line says: up while thinking, down while writing", () => {
    expect(renderToStaticMarkup(<MateFace gaze="up" state="working" tint="sand" />)).toContain(
      'data-mate-face-gaze="up"',
    );
    expect(renderToStaticMarkup(<MateFace state="working" tint="sand" />)).not.toContain(
      "data-mate-face-gaze",
    );
  });

  it("sizes as a dot, beside text, or as a card's avatar", () => {
    expect(renderToStaticMarkup(<MateFace size="dot" state="idle" tint="sand" />)).toContain(
      'data-mate-face-size="dot"',
    );
    expect(renderToStaticMarkup(<MateFace size="sm" state="idle" tint="sand" />)).toContain(
      "size-5",
    );
    expect(renderToStaticMarkup(<MateFace state="idle" tint="sand" />)).toContain("size-7");
  });
});
