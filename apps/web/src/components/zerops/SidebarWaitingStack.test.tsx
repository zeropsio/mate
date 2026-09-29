import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  namesInOneBreath,
  SidebarWaitingStack,
  waitingFacesThatFit,
  type WaitingMate,
} from "./SidebarWaitingStack";

const waiting = (id: string): WaitingMate => ({
  projectId: id,
  name: id,
  tint: "sky",
  shape: "gem",
  face: "needs",
});

describe("SidebarWaitingStack — the Mates waiting on you, in the header", () => {
  it("stacks their faces as one button that goes to the next, naming them all", () => {
    const html = renderToStaticMarkup(
      <SidebarWaitingStack mates={[waiting("Kai"), waiting("Juno")]} onNext={() => {}} />,
    );
    expect(html).toContain('data-zerops-surface="sidebar-waiting"');
    expect(html.match(/data-zerops-waiting-mate=/gu)).toHaveLength(2);
    expect(html).toContain(
      'aria-label="Kai and Juno wait on you. Go to the next one: Option and Down."',
    );
    expect(html).toContain('data-mate-face-state="needs"');
    // Each in the face its person picked.
    expect(html.match(/data-mate-face-shape="gem"/gu)).toHaveLength(2);
    // No count and no word beside the faces.
    expect(html).not.toContain(">2<");
  });

  it("shows four faces at most, then how many more", () => {
    const html = renderToStaticMarkup(
      <SidebarWaitingStack mates={["a", "b", "c", "d", "e", "f"].map(waiting)} onNext={() => {}} />,
    );
    expect(html.match(/data-zerops-waiting-mate=/gu)).toHaveLength(4);
    expect(html).toContain(">+2<");
  });

  it("draws nothing where nobody waits, the slot staying the header's", () => {
    expect(renderToStaticMarkup(<SidebarWaitingStack mates={[]} onNext={() => {}} />)).toBe("");
  });

  it.each([
    [[], ""],
    [["Kai"], "Kai"],
    [["Kai", "Juno"], "Kai and Juno"],
    [["Kai", "Juno", "Mika"], "Kai, Juno and Mika"],
  ] as const)("names %j as %s", (names, said) => {
    expect(namesInOneBreath(names)).toBe(said);
  });
});

// The logo row keeps the mark and ⌘K whole; the waiting faces give way
// first. The room the row leaves them, as measured in the harness: the
// menu's width less its 1 px edge, the mark's inset (90 px beside macOS's
// traffic lights, 16 on the web), the mark (28, as wide as a Mate's face),
// the gap before ⌘K (8), ⌘K (49.5) and the row's end padding (16, the
// menu's end edge) — never more than the slot's 96.
describe("waitingFacesThatFit — the faces give way before the mark and ⌘K", () => {
  const room = (width: number, inset: number) =>
    Math.min(96, width - 1 - inset - 28 - 8 - 49.5 - 16);
  it.each([
    { name: "the web at 304: four", room: room(304, 16), count: 4, fit: { shown: 4, more: 0 } },
    {
      name: "the web at 304, six waiting: four and how many more",
      room: room(304, 16),
      count: 6,
      fit: { shown: 4, more: 2 },
    },
    { name: "the desktop at 304: four", room: room(304, 90), count: 4, fit: { shown: 4, more: 0 } },
    {
      name: "the desktop at 304, six waiting: four and how many more",
      room: room(304, 90),
      count: 6,
      fit: { shown: 4, more: 2 },
    },
    {
      name: "the desktop at 256: both faces",
      room: room(256, 90),
      count: 2,
      fit: { shown: 2, more: 0 },
    },
    {
      name: "the web at its narrowest, 208: all three",
      room: room(208, 16),
      count: 3,
      fit: { shown: 3, more: 0 },
    },
    { name: "a 50 px slot: one and how many more", room: 50, count: 3, fit: { shown: 1, more: 2 } },
    {
      name: "a 40 px slot: one face, its count giving way too",
      room: 40,
      count: 2,
      fit: { shown: 1, more: 0 },
    },
    { name: "no room for a face: none", room: 30, count: 2, fit: { shown: 0, more: 0 } },
    { name: "nobody waiting", room: 96, count: 0, fit: { shown: 0, more: 0 } },
  ])("$name", ({ room: slot, count, fit }) => {
    expect(waitingFacesThatFit(slot, count)).toEqual(fit);
  });
});
