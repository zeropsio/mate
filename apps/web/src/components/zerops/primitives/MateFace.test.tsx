import {
  MATE_FACE,
  MATE_SHAPE_OF_TINT,
  MATE_SHAPES,
  MATE_TINT_IDS,
  mateFaceParts,
  type MateMarkState,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";

import { MateFace, mateFaceArrival } from "./MateFace";

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
      `--mate-face-origin:${MATE_SHAPES[shape].origin[0]}% ${MATE_SHAPES[shape].origin[1]}%`,
    );
    // The eyes are ink from the palette, never a literal.
    expect(html).toContain("fill-[var(--zerops-mate-face-ink)]");
    expect(html).not.toMatch(/#[0-9a-f]{6}/iu);
  });

  // A Mate picks its shape and its colour apart (HQ's record of its face): any shape in
  // any colour, turning by that shape's own symmetry.
  it.each<[MateTintId, MateShapeId]>([
    ["coral", "gem"],
    ["sky", "seal"],
    ["olive", "squircle"],
  ])("wears %s as a %s when its Mate chose so", (tint, shape) => {
    const html = renderToStaticMarkup(<MateFace shape={shape} state="idle" tint={tint} />);
    expect(html).toContain(`data-mate-face-tint="${tint}"`);
    expect(html).toContain(`data-mate-face-shape="${shape}"`);
    expect(html).toContain(`fill-[var(--zerops-mate-tint-${tint})]`);
    expect(html).toContain(`d="${MATE_SHAPES[shape].d}"`);
    expect(html).toContain(`--mate-face-step:${MATE_SHAPES[shape].step}deg`);
    expect(html).toContain(
      `--mate-face-origin:${MATE_SHAPES[shape].origin[0]}% ${MATE_SHAPES[shape].origin[1]}%`,
    );
  });

  it.each(MATE_TINT_IDS)("draws %s with no shape given exactly as its tint's own", (tint) => {
    expect(renderToStaticMarkup(<MateFace state="working" tint={tint} />)).toBe(
      renderToStaticMarkup(
        <MateFace shape={MATE_SHAPE_OF_TINT[tint]} state="working" tint={tint} />,
      ),
    );
  });

  // Chrome hands a running animation to the compositor only on an HTML box, never on an SVG
  // element: every part that moves on its own (the hop, the turn, the look, the glance) is a box
  // of its own over the whole face, each holding its drawing in the same 100-box, so a menu of
  // faces at work costs the page no frames.
  it.each<MateMarkState>(["idle", "working", "needs", "done", "sleep", "waking"])(
    "moves %s as HTML boxes over one 100-box",
    (state) => {
      const html = renderToStaticMarkup(<MateFace state={state} tint="sky" />);
      const tagsOf = (part: string) =>
        [...html.matchAll(new RegExp(`<(\\w+) [^>]*data-mate-face-${part}=""`, "gu"))].map(
          (match) => match[1],
        );
      for (const part of ["hop", "body", "look", "glance"]) expect(tagsOf(part)).toEqual(["span"]);
      expect(html).toMatch(/^<span [^>]*data-zerops-primitive="mate-face"/u);
      const boxes = [...html.matchAll(/<svg [^>]*>/gu)].map((match) => match[0]);
      expect(boxes.length).toBeGreaterThan(1);
      for (const box of boxes) expect(box).toContain(`viewBox="${MATE_FACE.viewBox}"`);
    },
  );

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

  // Waking — a Mate on its way up (`matePose`) — draws asleep's closed eyes; only its state, and
  // the stylesheet's breath for it, tell the two apart.
  it("shuts its eyes waking as asleep, and says it is waking", () => {
    const html = renderToStaticMarkup(<MateFace size="sm" state="waking" tint="sky" />);
    const face = parts(html);
    const asleep = parts(renderToStaticMarkup(<MateFace size="sm" state="sleep" tint="sky" />));
    expect(face.shut.map((line) => line.opacity)).toEqual(["1", "1"]);
    expect(face.eyes).toEqual(asleep.eyes);
    expect(html).toContain('data-mate-face-state="waking"');
  });

  // A face greets an arrival while it is on screen: a run done after work or
  // a question, a question raised — never marking a Mate unread (idle to done),
  // never a state it already held.
  it.each<[MateMarkState, MateMarkState, MateMarkState | undefined]>([
    ["working", "done", "done"],
    ["needs", "done", "done"],
    ["idle", "done", undefined],
    ["working", "needs", "needs"],
    ["idle", "needs", "needs"],
    ["done", "idle", undefined],
    ["idle", "working", undefined],
  ])("greets %s → %s as %s", (previous, next, arrival) => {
    expect(mateFaceArrival(previous, next)).toBe(arrival);
  });

  it("greets no arrival from a pose that only stood in until the state was read", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const arrivedOf = (renderer: ReturnType<typeof create>) =>
      renderer.root.findByProps({ "data-zerops-primitive": "mate-face" }).props[
        "data-mate-face-arrived"
      ];
    let renderer: ReturnType<typeof create> | undefined;
    // A menu row after a reload: idle until its socket answers that the Mate waits.
    act(() => {
      renderer = create(<MateFace greets known={false} state="idle" tint="sky" />);
    });
    act(() => renderer!.update(<MateFace greets known state="needs" tint="sky" />));
    expect(arrivedOf(renderer!)).toBeUndefined();
    // Read, a question raised while it is on screen is greeted.
    act(() => renderer!.update(<MateFace greets known state="working" tint="sky" />));
    act(() => renderer!.update(<MateFace greets known state="needs" tint="sky" />));
    expect(arrivedOf(renderer!)).toBe("needs");
    act(() => renderer!.unmount());
  });

  // A face reused from one Mate to the next (a header), or drawn
  // asleep until its Mate connects, would greet arrivals that never happened:
  // greeting is the menu row's and the status line's alone.
  it("greets nothing unless asked to", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<MateFace state="working" tint="rose" />);
    });
    act(() => renderer!.update(<MateFace state="needs" tint="rose" />));
    expect(
      renderer!.root.findByProps({ "data-zerops-primitive": "mate-face" }).props[
        "data-mate-face-arrived"
      ],
    ).toBeUndefined();
    act(() => renderer!.unmount());
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
