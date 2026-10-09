import {
  crewConversationId,
  crewEngineSnapshotFixture,
  crewSnapshotFixture,
} from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  CrewSeamActivity,
  CrewTaskCard,
  CrewTimelineContext,
  type CrewTimeline,
} from "./CrewTaskCard";
import { crewCardOrigin } from "./CrewTaskCard.logic";

const CARD = {
  title: "#12 Add pagination to /api/items · from your message",
  text: "Add cursor pagination.",
};

const TIMELINE: CrewTimeline = {
  firstCardId: "entry-1",
  origin: {
    text: "You cleared its conversation",
    previousThreadId: ThreadId.make("thread-crew-backend-1"),
  },
  tasks: crewSnapshotFixture().board.tasks,
  crewmate: { handle: "backend", profile: null },
  mateName: "Fen",
  onOpenThread: () => {},
  onChangeJob: null,
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
    expect(html).toContain("You cleared its conversation");
    expect(html).toContain("previous conversation ↗");
  });

  it("names the task by its title alone: no number, no label, no source", () => {
    const html = render("entry-7", TIMELINE);
    expect(html).toContain("Add pagination to /api/items");
    expect(html).not.toMatch(/#12|from your message|from a message|>Task</u);
  });

  it("draws no seam above a later card", () => {
    expect(render("entry-7", TIMELINE)).not.toContain("data-crew-seam");
  });

  it("draws a card outside a crew chat by its own title", () => {
    const html = render("entry-1", null);
    expect(html).toContain("Add pagination to /api/items");
    expect(html).not.toContain("data-crew-seam");
    expect(html).not.toContain("#12");
  });
});

describe("CrewTaskCard over the engine's typed card", () => {
  const TYPED = {
    title: "Add pagination",
    text: "Add cursor pagination.",
    typed: {
      kind: "task",
      taskId: "task-12",
      number: 12,
      title: "Add pagination",
      why: "Add cursor pagination.",
      doneWhen: null,
      links: [],
    },
  } as const;
  // A crewmate's one conversation: no stint origin, its sessions are lines in it.
  const ENGINE_TIMELINE: CrewTimeline = { ...TIMELINE, origin: null };
  const renderTyped = (id: string, timeline: CrewTimeline | null) =>
    renderToStaticMarkup(
      <CrewTimelineContext value={timeline}>
        <CrewTaskCard card={TYPED} id={id} />
      </CrewTimelineContext>,
    );

  it("opens a crewmate's conversation on its card alone, never a link to one before: its sessions are lines in it", () => {
    const backend = crewEngineSnapshotFixture().crewmates.find(
      (mate) => mate.handle === "backend",
    )!;
    const origin = crewCardOrigin({
      stints: backend.stints,
      threadId: crewConversationId("backend"),
      seamed: false,
    });
    const html = renderTyped("entry-1", { ...ENGINE_TIMELINE, firstCardId: "entry-1", origin });
    expect(html).toContain("data-crew-task-card");
    expect(html).not.toContain("data-crew-seam");
    expect(html).not.toContain("previous conversation");
  });

  it("names the task by its title alone: no number, no label, no source", () => {
    const html = renderTyped("entry-7", ENGINE_TIMELINE);
    expect(html).toContain("Add pagination to /api/items");
    expect(html).toContain("Add cursor pagination.");
    expect(html).not.toMatch(/#12|from your message|from a message|>Task</u);
  });

  it("draws no seam above a later card", () => {
    expect(renderTyped("entry-7", ENGINE_TIMELINE)).not.toContain("data-crew-seam");
  });

  it("draws a card outside a crew chat by its own title", () => {
    const html = renderTyped("entry-1", null);
    expect(html).toContain(">Add pagination</p>");
    expect(html).not.toContain("data-crew-seam");
    expect(html).not.toContain("#12");
  });
});

describe("CrewSeamActivity", () => {
  const renderSeam = (
    element: ReturnType<typeof CrewSeamActivity>,
    timeline: CrewTimeline | null,
  ) => renderToStaticMarkup(<CrewTimelineContext value={timeline}>{element}</CrewTimelineContext>);

  it("says work went into the Mate's code, by its title", () => {
    const html = renderSeam(
      <CrewSeamActivity
        seam={{ seam: "landed", taskId: "task-12", number: 12, commit: "a1b2c3d4e5f6" }}
        words="Task #12 landed as a1b2c3d4e5f6"
      />,
      TIMELINE,
    );
    expect(html).toContain("data-crew-seam");
    expect(html).toContain("Add pagination to /api/items went into Fen&#x27;s code");
    expect(html).not.toContain("a1b2c3d");
  });

  it("says work that closed with nothing to add, by its title", () => {
    const html = renderSeam(
      <CrewSeamActivity
        seam={{ seam: "closed", taskId: "task-12", number: 12 }}
        words="Task #12 closed — nothing to land"
      />,
      TIMELINE,
    );
    expect(html).toContain(
      "Add pagination to /api/items closed with nothing to add to Fen&#x27;s code",
    );
    expect(html).not.toMatch(/#12|nothing to land/u);
  });

  it("links a new conversation to the one before it", () => {
    const html = renderSeam(
      <CrewSeamActivity
        seam={{ seam: "stint", previousThreadId: ThreadId.make("thread-crew-backend-1") }}
        words="You cleared its conversation"
      />,
      TIMELINE,
    );
    expect(html).toContain("You cleared its conversation");
    expect(html).toContain("previous conversation ↗");
  });

  it("says why a crewmate's one conversation started again, linking nowhere", () => {
    const html = renderSeam(
      <CrewSeamActivity
        seam={{ seam: "stint", previousThreadId: null }}
        words="You cleared its conversation — it keeps its job and its work"
      />,
      TIMELINE,
    );
    expect(html).toContain("You cleared its conversation — it keeps its job and its work");
    expect(html).not.toContain("previous conversation");
  });

  it("says a save in the engine's words, with nothing to open", () => {
    const html = renderSeam(
      <CrewSeamActivity
        seam={{ seam: "saved", apply: "nextTurn" }}
        words="Its job changed — from its next message"
      />,
      TIMELINE,
    );
    expect(html).toContain("Its job changed — from its next message");
    expect(html).not.toContain("↗");
  });
});
