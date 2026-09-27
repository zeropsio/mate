import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  CrewSeamActivity,
  CrewTaskCard,
  CrewTimelineContext,
  type CrewTimeline,
} from "./CrewTaskCard";

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

describe("CrewSeamActivity", () => {
  const renderSeam = (
    element: ReturnType<typeof CrewSeamActivity>,
    timeline: CrewTimeline | null,
  ) => renderToStaticMarkup(<CrewTimelineContext value={timeline}>{element}</CrewTimelineContext>);

  it("names a landing by its short sha", () => {
    const html = renderSeam(
      <CrewSeamActivity
        seam={{ seam: "landed", taskId: "task-12", number: 12, commit: "a1b2c3d4e5f6" }}
        words="Task #12 landed as a1b2c3d4e5f6"
      />,
      TIMELINE,
    );
    expect(html).toContain("data-crew-seam");
    expect(html).toContain("Task #12 landed as a1b2c3d<");
  });

  it("links a new conversation to the one before it", () => {
    const html = renderSeam(
      <CrewSeamActivity
        seam={{ seam: "stint", previousThreadId: ThreadId.make("thread-crew-backend-1") }}
        words="Started fresh by you"
      />,
      TIMELINE,
    );
    expect(html).toContain("Started fresh by you");
    expect(html).toContain("previous conversation ↗");
  });

  it("says a save in the engine's words, with nothing to open", () => {
    const html = renderSeam(
      <CrewSeamActivity
        seam={{ seam: "saved", apply: "nextTurn" }}
        words="Job updated to v5 — the next turn starts a fresh conversation"
      />,
      TIMELINE,
    );
    expect(html).toContain("Job updated to v5 — the next turn starts a fresh conversation");
    expect(html).not.toContain("↗");
  });
});
