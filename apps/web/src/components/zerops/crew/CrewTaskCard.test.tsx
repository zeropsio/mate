import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CrewTaskCard, CrewTimelineContext, type CrewTimeline } from "./CrewTaskCard";

const CARD = { title: "#12 Add pagination to /api/items", text: "Add cursor pagination." };

const TIMELINE: CrewTimeline = {
  firstCardId: "entry-1",
  origin: {
    text: "Started fresh by you",
    previousThreadId: ThreadId.make("thread-crew-backend-1"),
  },
  tasks: crewSnapshotFixture().board.tasks,
  onOpenThread: () => {},
};

const render = (id: string, timeline: CrewTimeline | null) =>
  renderToStaticMarkup(
    <CrewTimelineContext value={timeline}>
      <CrewTaskCard card={CARD} id={id} />
    </CrewTimelineContext>,
  );

describe("CrewTaskCard", () => {
  it("opens a stint's first card with why the conversation began and a link to the one before", () => {
    const html = render("entry-1", TIMELINE);
    expect(html).toContain("data-crew-seam");
    expect(html).toContain("Started fresh by you");
    expect(html).toContain("previous conversation ↗");
    expect(html).toContain("from a message");
  });

  it("draws no seam above a later card", () => {
    expect(render("entry-7", TIMELINE)).not.toContain("data-crew-seam");
  });

  it("draws a card outside a crew chat as it was written", () => {
    const html = render("entry-1", null);
    expect(html).toContain("#12 Add pagination to /api/items");
    expect(html).not.toContain("data-crew-seam");
    expect(html).not.toContain("from a message");
  });
});
