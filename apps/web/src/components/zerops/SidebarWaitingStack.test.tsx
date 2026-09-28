import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { namesInOneBreath, SidebarWaitingStack, type WaitingMate } from "./SidebarWaitingStack";

const waiting = (id: string): WaitingMate => ({
  projectId: id,
  name: id,
  tint: "sky",
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
