import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { EnvironmentId, ThreadId, type CrewTask, type Crewmate } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CrewTimelineContext, type CrewTimeline } from "./CrewTaskCard";
import { CrewmateEmptyState } from "./CrewmateEmptyState";

const crew = crewSnapshotFixture();
const mate = (handle: string): Crewmate => crew.crewmates.find((each) => each.handle === handle)!;
const BACKEND = mate("backend");
const LEAD: Crewmate = {
  ...mate("lead"),
  jobFirstLine: "You lead the Letopis crew: Server and world, Game systems, Clients and creation.",
};
const REVIEWER: Crewmate = {
  ...BACKEND,
  handle: "referee",
  displayName: "Referee",
  tint: "rose",
  kind: "reader",
  readOnly: true,
  jobFirstLine: "You review every change: nothing may break a saved world. Ask before you block.",
  host: null,
  lane: null,
  app: null,
};

const FEN_FACE = { tint: "amber", shape: MATE_SHAPE_OF_TINT.amber, connected: true } as const;
const ENVIRONMENT = EnvironmentId.make("environment-fen");

const timeline = (
  profile: Crewmate | null,
  fields: Partial<CrewTimeline> = {},
  handle = profile?.handle ?? "backend",
): CrewTimeline => ({
  firstCardId: null,
  origin: null,
  tasks: [],
  crewmate: { handle, profile },
  mateName: "Fen",
  onOpenThread: () => {},
  onChangeJob: () => {},
  ...fields,
});

const render = (
  crewTimeline: CrewTimeline,
  options: {
    readonly seams?: Parameters<typeof CrewmateEmptyState>[0]["seams"];
    readonly mateFace?: Parameters<typeof CrewmateEmptyState>[0]["mateFace"];
  } = {},
) =>
  renderToStaticMarkup(
    <CrewTimelineContext value={crewTimeline}>
      <CrewmateEmptyState
        bottomInset={132}
        crew={crewTimeline}
        environmentId={ENVIRONMENT}
        mateFace={options.mateFace === undefined ? FEN_FACE : options.mateFace}
        seams={options.seams ?? []}
      />
    </CrewTimelineContext>,
  );

/** The markup between two markers, for what stands in one part of the page. */
const between = (html: string, from: string, to: string) =>
  html.slice(html.indexOf(from), to === "" ? undefined : html.indexOf(to));

const landed = (
  id: string,
  number: number,
  title: string,
  commit: string | null,
  landedAt: string,
): CrewTask => ({
  ...crew.board.tasks[0]!,
  id,
  number,
  title,
  owner: "backend",
  state: "landed",
  landedCommit: commit,
  landedAt,
});

describe("CrewmateEmptyState", () => {
  it("stands on the Mate's own stage: its face a third of the way down, at the Mate's size and headline", () => {
    const html = render(timeline(BACKEND));
    expect(html).toContain('data-zerops-surface="crewmate-empty-state"');
    // The spacer the Mate's opening puts its face under (`ZeropsMateEmptyState`).

    expect(html).not.toContain("@backend");
  });

  it.each([
    { who: LEAD, says: "Fen&#x27;s lead · plans and reviews the crew&#x27;s work" },
    {
      who: BACKEND,
      says: "One of Fen&#x27;s crew · builds its part in its own copy of Fen&#x27;s code",
    },
    {
      who: REVIEWER,
      says: "One of Fen&#x27;s crew · checks the others&#x27; work and changes nothing",
    },
  ])("says whose $who.displayName is under its name, led by Fen's small face", ({ who, says }) => {
    const whose = between(render(timeline(who)), "data-crewmate-whose", "data-crewmate-card");
    expect(whose).toContain(says);
    expect(whose).toContain('data-mate-face-tint="amber"');
    expect(whose).toContain('data-mate-face-size="sm"');
  });

  it("says whose it is without a face while the Mate's is not known", () => {
    const whose = between(
      render(timeline(BACKEND), { mateFace: null }),
      "data-crewmate-whose",
      "data-crewmate-card",
    );
    expect(whose).toContain("One of Fen&#x27;s crew");
    expect(whose).not.toContain("data-mate-face-tint");
  });

  it("shows its job's first line in the person's words, headed as the job view heads it", () => {
    const card = between(render(timeline(REVIEWER)), "data-crewmate-card", "");
    expect(card).toContain(">Its job<");
    expect(card).toContain("Reviews every change: nothing may break a saved world.");
    expect(card).not.toContain("Ask before you block");
  });

  it("offers Change its job only to a viewer who may change the crew", () => {
    expect(render(timeline(LEAD))).toContain(">Change its job<");
    expect(render(timeline(LEAD, { onChangeJob: null }))).not.toContain("Change its job");
  });

  it("never invites a message: the composer does, or says why this viewer cannot", () => {
    expect(render(timeline(BACKEND))).not.toContain("Message Backend");
  });

  it("lists the work it finished, the newest three, and opens the rest in place", () => {
    const tasks = [
      landed("t1", 1, "World persistence", "c4d9e02", "2026-09-27T08:10:00.000Z"),
      landed("t2", 2, "Check the save format", null, "2026-09-27T09:40:00.000Z"),
      landed("t3", 3, "Season clock on the server", "5e1a2b7", "2026-09-27T10:05:00.000Z"),
      landed("t4", 4, "Health endpoint", "a1b2c3d", "2026-09-27T11:00:00.000Z"),
    ];
    const work = between(render(timeline(BACKEND, { tasks })), "data-crewmate-work", "");
    expect(work).toContain(">Its work<");
    // Newest first, each by its title and what became of it.
    const order = ["Health endpoint", "Season clock on the server", "Check the save format"];
    expect(order.map((title) => work.indexOf(`>${title}<`))).toEqual(
      order.map((title) => work.indexOf(`>${title}<`)).toSorted((left, right) => left - right),
    );
    expect(work).toContain(">went into Fen&#x27;s code<");
    expect(work).toContain(">closed with nothing to add to Fen&#x27;s code<");
    expect(work).not.toContain("World persistence");
    expect(work).toContain(">Show all 4<");
    // Work that went in opens its review; work that closed with nothing to add has none to open.
    expect(work).toContain('data-crewmate-work-task="t4"');
    expect(work).not.toContain('data-crewmate-work-task="t2"');
  });

  it("draws no work while it finished none", () => {
    expect(render(timeline(BACKEND))).not.toContain("data-crewmate-work");
  });

  it("stands the conversation's seam on top of it", () => {
    const html = render(timeline(BACKEND), {
      seams: [
        {
          id: "seam-1",
          seam: { seam: "stint", previousThreadId: ThreadId.make("thread-crew-backend-1") },
          words: "You cleared its conversation",
        },
      ],
    });
    expect(html.indexOf("You cleared its conversation")).toBeLessThan(html.indexOf(">Backend<"));
    expect(html).toContain("previous conversation ↗");
  });

  it("says why a later conversation began and links the one before, where no seam of its own does", () => {
    const html = render(
      timeline(BACKEND, {
        origin: {
          text: "New conversation",
          previousThreadId: ThreadId.make("thread-crew-backend-1"),
        },
      }),
    );
    expect(html.indexOf("New conversation")).toBeLessThan(html.indexOf(">Backend<"));
    expect(html).toContain("previous conversation ↗");
  });

  // A reload paints nothing it takes back: no handle stands in for the name, and no stand-in
  // face — both places are held, empty, until the crewmate is read, and it paints into them.
  it("holds its face's and its name's places, empty, while the crew is not read yet", () => {
    const html = render(timeline(null, {}, "backend"));
    expect(html).not.toContain("backend");
    expect(html).not.toContain("<h1");

    expect(html).not.toContain("data-mate-face-tint");
    expect(html).not.toContain("data-crewmate-whose");
    expect(html).not.toContain("data-crewmate-card");
  });
});
