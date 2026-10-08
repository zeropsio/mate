import { crewAccess, type CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
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
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

/** What a viewer may run: every login but those `closed`, each signed in by somebody else. */
const accessOf = (snapshot: CrewSnapshot, closed: ReadonlyArray<string>) =>
  crewAccess({
    snapshot,
    lockOf: (login) => (closed.includes(login) ? lockOn(login) : null),
    defaultLogin: "claudeAgent",
    reading: false,
  });

const lockOn = (login: string): CrewLock => ({
  login,
  agentId: "claude-code",
  ownership: "someone-else",
});

const render = (snapshot: CrewSnapshot, overrides: Partial<CrewSectionProps> = {}) =>
  renderToStaticMarkup(
    <CrewSection
      access={accessOf(snapshot, [])}
      askLock={null}
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
      onSignIn={noop}
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
  it("says what a crew is and offers its setup action", () => {
    const html = renderToStaticMarkup(
      <CrewSectionEmpty
        lock={null}
        mate={{ name: "Fen", tint: "amber" }}
        onSetUp={noop}
        onSignIn={noop}
      />,
    );
    expect(textOf(html)).toBe(
      [
        "Give Fen a crew",
        "For a job too big for one conversation. A lead plans it, and crewmates build its parts side by side, each in its own copy of Fen's code. Nothing goes into Fen's code until you review it.",
        "Set up a crew",
      ].join(" "),
    );
  });

  it("says why, with the one way out, in place of Set up a crew for a viewer who may not run it", () => {
    const html = renderToStaticMarkup(
      <CrewSectionEmpty
        lock={lockOn("claudeAgent")}
        mate={{ name: "Fen", tint: "amber" }}
        onSetUp={noop}
        onSignIn={noop}
      />,
    );
    expect(textOf(html)).toContain(
      "Signed in by another project member — only they can run this crew. Sign in with your own account",
    );
    expect(html).not.toContain(">Set up a crew</button>");
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

describe("CrewSection — for a viewer who may not run the crew (D6)", () => {
  const LOGINS = ["claudeAgent", "codex"];
  const closed = (snapshot: CrewSnapshot = FIXTURE) =>
    render(snapshot, { access: accessOf(snapshot, LOGINS), askLock: lockOn("claudeAgent") });

  it("puts why and the one way out in the composer's own place", () => {
    const html = closed();
    expect(html).not.toContain("data-crew-composer");
    expect(html).toContain('data-crew-locked="someone-else"');
    expect(textOf(html)).toContain(
      "Signed in by another project member — only they can run this crew. Sign in with your own account",
    );
  });

  it("reads every row, need and piece of work, and offers nothing that runs or changes the crew", () => {
    const text = textOf(closed());
    for (const words of [
      "Working on its own · $6.40 of $20 · 1 h 12 m of 8 h",
      "Wants to show its work at Fen's dev address.",
      "Pricing in CZK or EUR?",
      "Stopped: the check timed out twice.",
      "In Fen's code",
      "Fen hasn't shipped these yet",
    ]) {
      expect(text).toContain(words);
    }
    expect(text).not.toMatch(
      /Let it|Not now|Answer|Try again|Drop it|Ask Fen to|Keep going|Let it work/u,
    );
  });

  it("offers Stop alone on a running crew: a colleague stops what they may not start", () => {
    const html = closed();
    const head = html.slice(0, html.indexOf("data-crew-locked"));
    expect(head).toContain(">Stop</button>");
    expect(html.match(/<button[^>]*>Stop<\/button>/gu)).toHaveLength(1);
  });

  it.each([
    ["stopped at its money", { ...RUN, state: "paused", reason: "budget", spentUsd: 20 }],
    ["stopped by a refusal", { ...RUN, state: "paused", reason: "refused", reasonDetail: "x" }],
  ] as const)("offers nothing to keep a crew %s going", (_state, run) => {
    const html = closed({ ...FIXTURE, run });
    expect(html).not.toMatch(/>(?:Keep going…|Try again)<\/button>/u);
  });

  it("offers no menu and no goal to change, the goal's title only read", () => {
    const html = closed();
    expect(html).not.toContain("The crew&#x27;s menu");
    expect(html).not.toMatch(/aria-label="[^"]* menu"/u);
    expect(html).toMatch(/<span[^>]*data-crew-goal-title[^>]*>Camera and HUD rework<\/span>/u);
  });

  it("closes only what reaches a login the viewer may not run", () => {
    // Backend alone runs on a login signed in by somebody else.
    const mixed: CrewSnapshot = {
      ...FIXTURE,
      crewmates: FIXTURE.crewmates.map((mate) =>
        mate.handle === "backend"
          ? { ...mate, login: { id: "claudeAgent_eva", label: "eva", agent: "claude-code" } }
          : mate,
      ),
    };
    const html = render(mixed, { access: accessOf(mixed, ["claudeAgent_eva"]) });
    const text = textOf(html);
    expect(html).toContain("data-crew-composer");
    expect(text).toContain("Wants to show its work at Fen's dev address.");
    expect(text).not.toMatch(/Let it|Not now/u);
    expect(text).toContain("Pricing in CZK or EUR? Answer");
    // Stopping the run is every member's.
    expect(html).toContain(">Stop</button>");
  });
});
