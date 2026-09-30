import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, type CrewSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { readCrewThread } from "../../../zerops/crew/useCrew";
import { CrewSection, CrewSectionEmpty, type CrewSectionProps } from "./CrewSection";

const noop = () => {};
const sent = async () => null;

/** The visible text, tags and style sheets stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<style[^>]*>.*?<\/style>/gsu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

const render = (snapshot: CrewSnapshot, overrides: Partial<CrewSectionProps> = {}) =>
  renderToStaticMarkup(
    <CrewSection
      busy={false}
      environmentId={EnvironmentId.make("env-crew")}
      errorAt={() => null}
      mateName="Fen"
      onAsk={noop}
      onHeadMenu={noop}
      onModePress={noop}
      onOpenThread={noop}
      onReview={noop}
      onRowMenu={noop}
      onShip={noop}
      renderPlan={() => null}
      send={sent}
      snapshot={snapshot}
      tell={{ send: sent, pending: false, error: null }}
      treeCwd="/var/www"
      view={deriveCrewView(snapshot, [], readCrewThread)}
      {...overrides}
    />,
  );

const FIXTURE = crewSnapshotFixture();
const RUN = FIXTURE.run!;

describe("CrewSectionEmpty — no crew yet", () => {
  it("says what a crew is, with Fen and three empty seats, and one press", () => {
    const html = renderToStaticMarkup(
      <CrewSectionEmpty mate={{ name: "Fen", tint: "amber" }} onSetUp={noop} />,
    );
    expect(textOf(html)).toBe(
      [
        "Give Fen a crew",
        "For a job too big for one conversation. A lead plans it, and crewmates build its parts side by side, each in its own copy of Fen's code. Nothing goes into Fen's code until you review it.",
        "Set up a crew",
      ].join(" "),
    );
    expect(html.match(/class="crew-seat"/gu)).toHaveLength(3);
  });
});

describe("CrewSection — the Crew tab's column", () => {
  it("reads top to bottom: the goal, how it works, the composer, the lead first, then Fen's code", () => {
    const text = textOf(render(FIXTURE));
    const order = [
      "Camera and HUD rework",
      "Working on its own · $6.40 of $20 · 1 h 12 m of 8 h",
      "Stop",
      "To Lead",
      "Lead Plans the work",
      "Backend",
      "Frontend",
      "Erik",
      "In Fen's code",
      "Fen hasn't shipped these yet",
      "Ask Fen to ship them",
    ].map((words) => text.indexOf(words));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("says what each crewmate needs in its own row, with the presses that answer it", () => {
    const text = textOf(render(FIXTURE));
    for (const [need, presses] of [
      ["Wants to show its work at Fen's dev address.", "Let it Not now"],
      [
        "Can't go into Fen's code yet: Fen has uncommitted edits to hud.ts.",
        "Ask Fen to commit them",
      ],
      ["Pricing in CZK or EUR?", "Answer"],
      ["Stopped: the check timed out twice.", "Try again Drop it"],
    ] as const) {
      expect(text).toContain(`${need} ${presses}`);
    }
  });

  it("tightens at a phone's width: the head, the composer and the rows closer, the ship line short", () => {
    const html = render(FIXTURE);
    expect(html).toContain('pt-4 @max-md:pt-3" data-crew-head');
    expect(html).toContain('mt-4 @max-md:mt-3.5" data-crew-composer');
    expect(html).toContain('@max-md:mt-4" data-crew-rows');
    expect(html).toContain('class="hidden @max-md:inline">Not shipped yet</span>');
    expect(html).toMatch(/class="truncate @max-md:hidden">Fen hasn&#x27;t shipped these yet</u);
  });

  it("names nothing of the engine's: no version, handle, number, status word or engine noun", () => {
    const text = textOf(render(FIXTURE));
    expect(text).not.toMatch(/\bv\d+\b|@[a-z]|#\d+/u);
    expect(text).not.toMatch(/\b(?:LEAD|TASK|RUNNING|IDLE|QUEUED|PAUSED)\b/u);
    expect(text).not.toMatch(
      /\bIdle\b|Waiting on you|\bLand(?:ed|ing)?\b|\bDeliver|\bBrief\b|\bRun\b/u,
    );
  });

  it("draws no empty list: nothing in Fen's code draws no heading, no need draws no press", () => {
    const quiet: CrewSnapshot = {
      ...FIXTURE,
      attention: [],
      board: { tasks: [] },
      landedNotDelivered: 0,
    };
    const text = textOf(render(quiet));
    expect(text).not.toContain("In Fen's code");
    expect(text).not.toMatch(/Answer|Let it|Try again|Drop it/u);
  });

  it.each([
    ["working on its own", RUN, "Stop"],
    [
      "stopped at its money",
      { ...RUN, state: "paused", reason: "budget", spentUsd: 20 },
      "Keep going…",
    ],
    [
      "stopped by a refusal",
      { ...RUN, state: "paused", reason: "refused", reasonDetail: "signed out" },
      "Try again",
    ],
  ] as const)("offers one press for how the crew works while %s", (_state, run, press) => {
    const html = render({ ...FIXTURE, run });
    expect(html).toContain(`>${press}</button>`);
  });

  it("offers no press in the head while the crew works only when asked", () => {
    const html = render({ ...FIXTURE, run: null, attention: [], board: { tasks: [] } });
    const head = html.slice(0, html.indexOf("data-crew-composer"));
    expect(textOf(head)).toContain("Works when you give it something to do");
    expect(head).not.toMatch(/>(?:Stop|Keep going…|Try again|Let it work on its own…)<\/button>/u);
  });

  it("offers to let it work on its own while it works with you on something", () => {
    const html = render({ ...FIXTURE, run: null });
    const head = html.slice(0, html.indexOf("data-crew-composer"));
    expect(textOf(head)).toContain("Working with you · finished work waits for your review");
    expect(head).toContain(">Let it work on its own…</button>");
  });

  it("names the Mate where the engine's words say your Mate or your tree", () => {
    const text = textOf(
      render({
        ...FIXTURE,
        lastError: "Start appdev's dev server first — ask your Mate to run it.",
      }),
    );
    expect(text).toContain("Start appdev's dev server first — ask Fen to run it.");
    expect(text).not.toContain("your Mate");
  });

  it("says a refused press beside the row it was pressed in", () => {
    const html = render(FIXTURE, {
      errorAt: (origin) => (origin === "crewmate:erik" ? "That task is gone." : null),
    });
    const erik = html.slice(html.indexOf('data-crew-row="erik"'));
    expect(textOf(erik)).toContain("That task is gone.");
  });
});
