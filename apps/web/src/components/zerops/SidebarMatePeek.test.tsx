import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { MatePeekCard, type MatePeekCardProps } from "./SidebarMatePeek";
import { askedLabelFor } from "./SidebarMatePeek.logic";

const card = (props: Partial<MatePeekCardProps> = {}) =>
  renderToStaticMarkup(
    <MatePeekCard
      appUrl="https://nova-app.example"
      askedLabel="You asked"
      change={<span>#14 Add a /status page</span>}
      decision={undefined}
      face="working"
      lastWords="The handler reads the build number from the environment."
      name="Nova"
      onChoose={() => {}}
      onOpen={() => {}}
      onStop={undefined}
      onText={() => {}}
      projectName="Storefront"
      responding={false}
      steps={[
        { text: "Read the routes", state: "done" },
        { text: "Run the build", state: "running" },
        { text: undefined, state: "waiting" },
      ]}
      stepsLabel="Plan"
      task="Add a /status page that shows the build number"
      time={<span>3:12</span>}
      tint="sky"
      waitingOn={undefined}
      {...props}
    />,
  );
const sections = (html: string) =>
  [...html.matchAll(/data-zerops-peek-section="([^"]+)"/gu)].map((match) => match[1]);

describe("MatePeekCard — a Mate at a glance", () => {
  it("says what you asked, the plan, its last words and its change, in that order", () => {
    const html = card();
    expect(sections(html)).toEqual(["task", "plan", "last-words", "change"]);
    expect(html).toContain(">You asked<");
    expect(html).toContain(">Plan<");
    expect(html).toContain(">Last words<");
    expect(html).toContain(">Change<");
    // No word says what the face shows.
    expect(html).not.toContain(">Working<");
  });

  it("marks each step done, running or waiting, and holds a waiting step's place until it is read", () => {
    const html = card();
    expect(html.match(/data-zerops-peek-step="done"/gu)).toHaveLength(1);
    expect(html.match(/data-zerops-peek-step="running"/gu)).toHaveLength(1);
    expect(html.match(/data-zerops-peek-step="waiting"/gu)).toHaveLength(1);
    expect(html).toContain('data-slot="skeleton"');
  });

  it("offers Open with its key and the Mate's app as a link, and leaves out what is not there", () => {
    const html = card();
    expect(html).toMatch(/>Open<kbd[^>]*>↵<\/kbd>/u);
    expect(html).toMatch(/<a[^>]*href="https:\/\/nova-app\.example"[^>]*target="_blank"/u);
    const bare = card({ appUrl: undefined, task: undefined, steps: undefined, change: undefined });
    expect(bare).not.toContain("Open app");
    expect(sections(bare)).toEqual(["last-words"]);
  });

  it("offers Stop with its key while it works", () => {
    expect(card({ onStop: () => {} })).toMatch(/>Stop<kbd[^>]*>X<\/kbd>/u);
    expect(card()).not.toContain(">Stop<");
  });
});

describe("askedLabelFor — whose ask it was", () => {
  it.each([
    { owner: { name: "Ales Rechtorik", isViewer: true }, label: "You asked" },
    { owner: { name: "Petra Malá", isViewer: false }, label: "Petra asked" },
    { owner: undefined, label: "Asked" },
  ])("reads $owner as $label", ({ owner, label }) => {
    expect(askedLabelFor(owner)).toBe(label);
  });
});
