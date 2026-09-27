import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CrewTimelineContext, type CrewTimeline } from "./CrewTaskCard";
import { CrewmateEmptyState } from "./CrewmateEmptyState";

const BACKEND = crewSnapshotFixture().crewmates.find((mate) => mate.handle === "backend")!;

const timeline = (profile: CrewTimeline["crewmate"]["profile"]): CrewTimeline => ({
  firstCardId: null,
  origin: null,
  tasks: [],
  crewmate: { handle: "backend", profile },
  onOpenThread: () => {},
});

const render = (crew: CrewTimeline, seams: Parameters<typeof CrewmateEmptyState>[0]["seams"]) =>
  renderToStaticMarkup(
    <CrewTimelineContext value={crew}>
      <CrewmateEmptyState crewmate={crew.crewmate} seams={seams} />
    </CrewTimelineContext>,
  );

describe("CrewmateEmptyState", () => {
  it("opens an empty crewmate conversation with the crewmate: face, name, @handle, job, the invite", () => {
    const html = render(timeline(BACKEND), []);
    expect(html).toContain('data-zerops-surface="crewmate-empty-state"');
    expect(html).toContain('data-mate-face-tint="sky"');
    expect(html).toContain(">Backend<");
    expect(html).toContain("@backend");
    expect(html).toContain("Owns the API under src/api and its tests.");
    expect(html).toContain("Message Backend…");
    expect(html).not.toContain("data-crew-seam");
  });

  it("stands the conversation's seam on top of it", () => {
    const html = render(timeline(BACKEND), [
      {
        id: "seam-1",
        seam: { seam: "stint", previousThreadId: ThreadId.make("thread-crew-backend-1") },
        words: "Started fresh by you",
      },
    ]);
    expect(html.indexOf("Started fresh by you")).toBeLessThan(html.indexOf(">Backend<"));
    expect(html).toContain("previous conversation ↗");
  });

  it("names the crewmate by its handle while the crew is not read yet", () => {
    const html = render(timeline(null), []);
    expect(html).toContain(">@backend<");
    expect(html).toContain("Message @backend…");
    expect(html).not.toContain("data-mate-face-tint");
  });
});
