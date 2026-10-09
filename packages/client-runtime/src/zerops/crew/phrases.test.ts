import {
  CrewAttentionKind,
  CrewRefusalReason,
  type CrewAttention,
  type CrewLaneSummary,
  type CrewRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { AGENT_OWNERSHIP_RECOVERY_LABEL } from "../agentSignIn.ts";
import { agentOwnershipComposerNotice } from "../agentOwnership.ts";
import { crewSnapshotFixture } from "./testing/fixtures.ts";
import {
  CREW_LOCK_ACTION,
  CREW_MENU,
  CREW_MENU_LINES,
  CREW_MODE_PRESS,
  CREW_RESUME_TITLE,
  CREW_ROW_VERBS,
  CREW_TRY_IT_WORD,
  CREW_WORKING_WITH_YOU,
  CREW_WORKS_WHEN_ASKED,
  CREWMATE_EMPTY_WORDS,
  crewAfterWord,
  crewBackToMateWord,
  crewBriefPlainText,
  crewBrokenCopyWord,
  crewClosedOutcome,
  crewCommitEditAsk,
  crewDeliverAsk,
  crewDescribeAsk,
  crewDevHostDatabaseWord,
  crewDiffStatWord,
  crewEarlierStintNotice,
  crewFaceWord,
  crewJobLine,
  crewLockWords,
  crewJobSentence,
  crewLandingWords,
  crewLineNeedsWord,
  crewLineReadyWord,
  crewLoginRunsWord,
  crewMenuFailureWord,
  crewmateDoesWords,
  crewmateRoleWords,
  crewmateWhoseLine,
  crewMessagePlaceholder,
  crewMoreSummary,
  crewNamingTheMate,
  crewNeedSentence,
  crewNoDevHostWord,
  crewOnItsOwnWords,
  crewOperationStageWord,
  crewPendingNotice,
  crewPersonLands,
  crewPlanStartLine,
  crewPortsAsk,
  crewPossessive,
  crewReadyWords,
  crewRefusalSentence,
  crewKeepGoingLine,
  crewResumeBudgetHint,
  crewResumeTimeHint,
  crewResumeUsageHint,
  crewRowVerbLine,
  crewRunsOnWord,
  crewServedWord,
  crewSetUpFooter,
  crewStoppedWords,
  crewSuggestedLine,
  crewTryWorkLine,
  crewWentInOutcome,
  crewWentInWord,
  crewClosedWord,
  crewNotShippedWords,
  CREW_NOT_SHIPPED_SHORT,
  mateOwnChatWord,
} from "./phrases.ts";

it.each([
  ["preparing-copy", "its copy preparation ended"],
  ["committing", "its preservation step ended"],
  ["merging", "its merge ended"],
  ["setting-up", "its setup ended"],
  ["checking", "its check ended"],
  ["landing", "its landing ended"],
])("a confirmed %s receipt describes the ending without claiming success", (stage, word) => {
  expect(crewOperationStageWord(stage)).toBe(word);
});

const crew = crewSnapshotFixture();
const run = crew.run!;

/** A row of what the crew needs from you, as the snapshot lists it. */
const need = (fields: Partial<CrewAttention> & Pick<CrewAttention, "kind">): CrewAttention => ({
  id: `${fields.kind}:row`,
  handle: "backend",
  taskId: "task-12",
  text: null,
  paths: [],
  host: null,
  at: "2026-09-27T09:00:00.000Z",
  ...fields,
});

/** Words the tab never shows: versions, handles, task numbers, engine nouns. */
const ENGINE_NOUNS = /\bv\d+\b|@[a-z]|#\d+|\b(?:land(?:ed|ing|s)?|tree|lane|stint|brief)\b/iu;

describe("crewPossessive", () => {
  it.each([
    ["Fen", "Fen's"],
    ["Game systems", "Game systems'"],
    ["Lead", "Lead's"],
  ])("%s → %s", (name, whose) => {
    expect(crewPossessive(name)).toBe(whose);
  });
});

describe("crewPersonLands", () => {
  const landing = (mode: "person" | "lead" | "check") => ({
    ...run,
    options: { ...run.options, landing: mode },
  });

  it.each([
    [null, true],
    [landing("person"), true],
    [landing("lead"), false],
    [{ ...landing("check"), state: "paused" }, false],
    [{ ...landing("lead"), state: "stopped" }, true],
  ] as const)("with run %j: %s", (latestRun, lands) => {
    expect(crewPersonLands(latestRun)).toBe(lands);
  });
});

describe("the mode line's words", () => {
  const options = (budgetUsd: number | "unlimited", timeLimitHours: number | "unlimited") => ({
    ...run.options,
    budgetUsd,
    timeLimitHours,
  });

  it("says how the crew works without a run", () => {
    expect([CREW_WORKS_WHEN_ASKED, CREW_WORKING_WITH_YOU]).toEqual([
      "Works when you give it something to do",
      "Working with you · finished work waits for your review",
    ]);
  });

  it.each<[string, Pick<CrewRun, "spentUsd" | "elapsedMs" | "options">, string]>([
    ["within its limits", run, "Working on its own · $6.40 of $20 · 1 h 12 m of 8 h"],
    [
      "no spending limit",
      { ...run, options: options("unlimited", 8) },
      "Working on its own · $6.40 spent · 1 h 12 m of 8 h",
    ],
    [
      "no time limit",
      { ...run, elapsedMs: 45 * 60_000, options: options(20, "unlimited") },
      "Working on its own · $6.40 of $20 · 45 m",
    ],
    [
      "a budget in cents",
      { ...run, spentUsd: 0, options: options(2.5, 1) },
      "Working on its own · $0.00 of $2.50 · 1 h 12 m of 1 h",
    ],
  ])("working on its own: %s", (_, input, words) => {
    expect(crewOnItsOwnWords(input)).toBe(words);
  });

  it.each<[string, Partial<CrewRun>, string]>([
    [
      "its budget",
      { reason: "budget", spentUsd: 20 },
      "Stopped working on its own: it spent its $20",
    ],
    [
      "its time, spending something",
      { reason: "time", spentUsd: 6.4 },
      "Stopped working on its own: its 8 hours are up. It spent $6.40.",
    ],
    // Nothing spent says nothing about money: "It spent $0.00." was noise.
    [
      "its time, spending nothing",
      { reason: "time", spentUsd: 0 },
      "Stopped working on its own: its 8 hours are up",
    ],
    [
      "its time, spending less than a cent",
      { reason: "time", spentUsd: 0.004 },
      "Stopped working on its own: its 8 hours are up",
    ],
    [
      "an hour",
      { reason: "time", spentUsd: 1.25, options: options(20, 1) },
      "Stopped working on its own: its hour is up. It spent $1.25.",
    ],
    [
      "an hour, spending nothing",
      { reason: "time", spentUsd: 0, options: options(20, 1) },
      "Stopped working on its own: its hour is up",
    ],
    [
      "its time with no limit set",
      { reason: "time", spentUsd: 1.25, options: options(20, "unlimited") },
      "Stopped working on its own. It spent $1.25.",
    ],
    [
      "its time with no limit set, spending nothing",
      { reason: "time", spentUsd: 0, options: options(20, "unlimited") },
      "Stopped working on its own",
    ],
    [
      "the usage stop",
      { reason: "usage" },
      "Stopped working on its own: your Claude plan is at 80 %",
    ],
    [
      "a refused turn",
      { reason: "refused", reasonDetail: "Backend's login is signed out" },
      "Stopped working on its own: Backend's login is signed out",
    ],
    ["the person (an older client's Pause)", { reason: "person" }, "Stopped working on its own"],
  ])("stopped by %s", (_, fields, words) => {
    expect(crewStoppedWords({ ...run, state: "paused", ...fields })).toBe(words);
  });

  it("offers one press at a time, each in plain words", () => {
    expect(CREW_MODE_PRESS).toEqual({
      letItWork: "Let it work on its own…",
      stop: "Stop",
      keepGoing: "Keep going…",
      tryAgain: "Try again",
    });
  });
});

describe("the run dialog's words", () => {
  it.each([
    [
      "person",
      "Wait for my review",
      "It waits in the Crew tab: Review it, try it, add it to Fen's code.",
    ],
    [
      "lead",
      "Add it to Fen's code once the lead approves it",
      "The lead checks each piece and sends back what isn't right.",
    ],
    [
      "check",
      "Add it to Fen's code once its checks pass",
      "Nothing goes in while its checks fail.",
    ],
  ] as const)("when a piece of work is done: %s", (mode, label, line) => {
    expect(crewLandingWords(mode, "Fen")).toEqual({ label, line });
  });

  it("keeps going from where a limit stopped it", () => {
    expect(CREW_RESUME_TITLE).toBe("Keep going");
    expect(crewResumeBudgetHint(20, 20)).toBe("It spent $20.00 of $20. Give it more, or no limit.");
    expect(crewResumeTimeHint(8)).toBe("Its 8 hours are up. Give it more time, or no limit.");
    expect(crewResumeTimeHint(1)).toBe("Its hour is up. Give it more time, or no limit.");
    expect(crewResumeUsageHint(81)).toBe(
      "Your Claude plan is at 81 %. Let it go further, or turn the stop off.",
    );
  });

  it.each([
    [
      { budgetUsd: 20, timeLimitHours: 8 },
      "It carries on within its limits: up to $20, for up to 8 hours.",
    ],
    [
      { budgetUsd: 20, timeLimitHours: 1 },
      "It carries on within its limits: up to $20, for up to an hour.",
    ],
    [
      { budgetUsd: "unlimited", timeLimitHours: 8 },
      "It carries on within its limits: no spending limit, for up to 8 hours.",
    ],
    [
      { budgetUsd: 12.5, timeLimitHours: "unlimited" },
      "It carries on within its limits: up to $12.50, with no time limit.",
    ],
    [{ budgetUsd: "unlimited", timeLimitHours: "unlimited" }, "It carries on, with no limits."],
  ] as const)("keeps going after you stopped it within %o", (options, line) => {
    expect(crewKeepGoingLine(options)).toBe(line);
  });
});

describe("the plan's words", () => {
  it.each([
    [
      { budgetUsd: 20, timeLimitHours: 8 },
      "Start lets the crew work on its own: up to $20, for up to 8 hours.",
    ],
    [
      { budgetUsd: "unlimited", timeLimitHours: 1 },
      "Start lets the crew work on its own: no spending limit, for up to an hour.",
    ],
    [
      { budgetUsd: 5.5, timeLimitHours: "unlimited" },
      "Start lets the crew work on its own: up to $5.50, with no time limit.",
    ],
    [
      { budgetUsd: "unlimited", timeLimitHours: "unlimited" },
      "Start lets the crew work on its own, with no limits.",
    ],
    [null, "Start asks how much it may spend and for how long."],
  ] as const)("says what Start lets the crew do: %j", (options, words) => {
    expect(crewPlanStartLine(options)).toBe(words);
  });

  it("names what a planned task waits for", () => {
    expect(crewAfterWord("Season clock on the server")).toBe("after Season clock on the server");
  });
});

describe("crewNeedSentence", () => {
  const with_ = (kind: CrewAttention["kind"], fields: Partial<CrewAttention> = {}) =>
    crewNeedSentence(need({ kind, ...fields }), crew, "Fen");

  it.each<[string, CrewAttention["kind"], Partial<CrewAttention>, string]>([
    [
      "a question is the question itself",
      "question",
      { text: "Should worlds made before today get seasons too, or only new ones?" },
      "Should worlds made before today get seasons too, or only new ones?",
    ],
    ["a question without words", "question", {}, "It asks you something."],
    [
      "work waiting on the Mate's edits",
      "landing-wait",
      { paths: ["src/ui/hud.ts"] },
      "Can't go into Fen's code yet: Fen has uncommitted edits to hud.ts.",
    ],
    [
      "on several edits",
      "landing-wait",
      { paths: ["src/ui/hud.ts", "a.ts", "b.ts"] },
      "Can't go into Fen's code yet: Fen has uncommitted edits to hud.ts and 2 more.",
    ],
    ["finished work", "ready-to-land", {}, "Done, in its own copy · not in Fen's code yet"],
    [
      "asking to show its work",
      "show-on-dev",
      { host: "appdev" },
      "Wants to show its work at Fen's dev address.",
    ],
    [
      "stopped",
      "parked",
      { text: "the check timed out twice" },
      "Stopped: the check timed out twice.",
    ],
    [
      "couldn't start",
      "cant-start",
      { text: "its login is signed out" },
      "Couldn't start: its login is signed out.",
    ],
    [
      "a clash",
      "conflict",
      { paths: ["client/sky/sky.ts"] },
      "Clashes with what's now in Fen's code, in client/sky/sky.ts.",
    ],
    [
      "failing checks",
      "check-failed",
      { text: "error TS2322: nope" },
      "Its checks fail: error TS2322: nope.",
    ],
    [
      "stopped mid-way when the crew stopped",
      "stalled",
      { text: "when the $20 ran out" },
      "Stopped mid-way when the $20 ran out.",
    ],
    [
      "stopped mid-way for its own reason",
      "stalled",
      { text: "its turn was interrupted" },
      "Stopped mid-way: its turn was interrupted.",
    ],
    [
      "stopped mid-way, in an older server's words",
      "stalled",
      { text: "the run reached its budget" },
      "Stopped mid-way: the run reached its budget.",
    ],
    ["waiting for a review", "review-wait", {}, "Waits for the lead's review."],
    [
      "sent back by the lead",
      "sent-back",
      { taskId: "task-sent", text: "rain falls upward on slopes" },
      "The lead sent it back: rain falls upward on slopes.",
    ],
  ])("%s", (_, kind, fields, words) => {
    expect(with_(kind, fields)).toBe(words);
  });

  it("says the grant waits for its current step to end", () => {
    const [host] = crew.hosts;
    const waiting = {
      ...crew,
      hosts: [
        { ...host!, claim: { state: "requested" as const, handle: "backend", grantWaiting: true } },
      ],
    };
    expect(crewNeedSentence(need({ kind: "show-on-dev", host: "appdev" }), waiting, "Fen")).toBe(
      "Shows its work at Fen's dev address once its current step ends.",
    );
  });

  it("names dropped work a task waits for by its title", () => {
    const dropped = {
      ...crew,
      board: {
        tasks: crew.board.tasks.map((task) =>
          task.id === "task-15" ? { ...task, dependsOn: ["task-9"] } : task,
        ),
      },
    };
    expect(
      crewNeedSentence(need({ kind: "dependency-gone", taskId: "task-15" }), dropped, "Fen"),
    ).toBe("Waits for Rename the score endpoint, which was dropped.");
  });

  it("says every kind as a sentence, in the person's words", () => {
    for (const kind of CrewAttentionKind.literals) {
      const words = with_(kind, { text: "it went wrong", paths: ["a.ts"], host: "appdev" });
      expect(words, kind).toMatch(/^[A-Z]/u);
      expect(words, kind).not.toMatch(ENGINE_NOUNS);
    }
  });
});

describe("a row's words", () => {
  it("names each press in plain words", () => {
    expect(Object.values(CREW_ROW_VERBS)).toEqual([
      "Rebuild crew copy",
      "Use crew copy",
      "Thaw it",
      "Answer",
      "Review",
      "Review what it has",
      "Review it yourself",
      "Try it",
      "Let it",
      "Not now",
      "Try again",
      "Continue",
      "Drop it",
      "Start it anyway",
      "Ask the lead",
      "Ask it to rework",
      "Ask it to fix them",
      "Ask it to sort it out",
      "Send",
    ]);
    expect(crewBackToMateWord("Fen")).toBe("Back to Fen's");
  });

  it("says what each press does, never in the engine's words", () => {
    for (const verb of [...Object.keys(CREW_ROW_VERBS), "askToCommit", "backToMate"] as const) {
      const line = crewRowVerbLine(verb as Parameters<typeof crewRowVerbLine>[0], "Fen");
      expect(line, verb).toMatch(/^[A-Z].*\.$/u);
      expect(line, verb).not.toMatch(ENGINE_NOUNS);
    }
  });

  it("says finished work waits in its own copy", () => {
    expect(crewReadyWords("Fen")).toBe("Done, in its own copy · not in Fen's code yet");
  });

  it("says a broken copy, and nothing for one that is fine", () => {
    const lane = (fields: Partial<CrewLaneSummary>) => ({
      state: "ready" as const,
      detail: null,
      ...fields,
    });
    expect(crewBrokenCopyWord(lane({ state: "missing" }), "Fen")).toBe(
      "Its copy of Fen's code is missing",
    );
    expect(crewBrokenCopyWord(lane({ state: "failed", detail: "No free disk" }), "Fen")).toBe(
      "Its copy of Fen's code failed: No free disk",
    );
    expect(crewBrokenCopyWord(lane({ state: "frozen" }), "Fen")).toBeNull();
  });

  it("says whose work the Mate's dev address shows, only while a crewmate's is", () => {
    const host = crew.hosts[0]!;
    expect(crewServedWord(host, crew.crewmates, "Fen")).toBeNull();
    expect(
      crewServedWord(
        { ...host, served: { by: "crewmate", handle: "frontend" } },
        crew.crewmates,
        "Fen",
      ),
    ).toBe("Fen's dev address shows Frontend's work");
  });
});

describe("the setup's and the job's words", () => {
  it("says where the builders' copies go", () => {
    expect(crewSetUpFooter("Fen", ["appdev"])).toBe(
      "Each builder gets its own copy of Fen's code on appdev. Getting them ready takes a minute or two; each row shows how it's going.",
    );
  });

  it("says the rows came from the Mate only when they did", () => {
    expect(crewSuggestedLine("Fen", true)).toBe(
      "Fen suggested these from the goal. Click anyone to change them.",
    );
    expect(crewSuggestedLine("Fen", false)).toBe("Click anyone to change them.");
  });

  it("sums up what More holds", () => {
    expect(crewMoreSummary({ runsOn: "Claude Code", check: "npm test", run: "npm run dev" })).toBe(
      "Its name and face · runs on Claude Code · checks its work with npm test · starts its app with npm run dev",
    );
    expect(crewMoreSummary({ runsOn: "Codex", check: null, run: null })).toBe(
      "Its name and face · runs on Codex",
    );
  });

  it("says why a builder has no service to pick yet", () => {
    expect(crewNoDevHostWord("Fen")).toBe(
      "No dev service is mounted yet — ask Fen to start development first.",
    );
  });

  it.each([
    [
      "headings dropped",
      "The camera follows the player.\n## Binding decisions",
      "The camera follows the player.",
    ],
    [
      "list, quote and emphasis markers stripped",
      "- **Money** as integer cents\n> keep `REST`",
      "Money as integer cents\nkeep REST",
    ],
    // A person's brief reads a callout as a Mate's message does: its word run into its first line.
    [
      "a callout's word run into its first line",
      "> [!WARNING]\n> Keep the save format stable.\n\nThen the camera.",
      "Warning: Keep the save format stable.\nThen the camera.",
    ],
    ["a quote in a quote", "> > Keep it small.", "Keep it small."],
    ["at most two lines", "One.\n\nTwo.\nThree.", "One.\nTwo."],
    ["nothing left", "## Done when", ""],
  ])("reads the goal's first lines as plain text: %s", (_name, excerpt, plain) => {
    expect(crewBriefPlainText(excerpt)).toBe(plain);
  });
});

describe("crewNamingTheMate", () => {
  it("names the Mate where the engine says your Mate or your tree", () => {
    expect(
      crewNamingTheMate("Start appdev's dev server first — ask your Mate to run it.", "Fen"),
    ).toBe("Start appdev's dev server first — ask Fen to run it.");
    expect(crewNamingTheMate("hud.ts is edited in your tree", "Fen")).toBe(
      "hud.ts is edited in Fen's code",
    );
    expect(crewNamingTheMate("Nothing to name here.", "Fen")).toBe("Nothing to name here.");
  });
});

describe("crewRefusalSentence", () => {
  it.each([
    ["no-mention", "Pick who it's for, or add a lead to split the work."],
    ["handle-taken", "That name is taken."],
    ["invalid-definition", "The crew's setup has a mistake."],
    ["io", "The crew's setup could not be read or saved."],
    ["unlanded-commits", "Some of its work isn't in your Mate's code yet."],
  ] as const)("refuses %s in plain words", (reason, words) => {
    expect(crewRefusalSentence(reason, null)).toBe(words);
  });

  it.each([
    [
      "wrong-state",
      "no dev server runs on appdev; start it first",
      "No dev server runs on appdev; start it first.",
    ],
    [
      "invalid-definition",
      "backend has no check command.",
      "The crew's setup has a mistake: Backend has no check command.",
    ],
    ["not-allowed", "  Backend's login is not yours!  ", "Backend's login is not yours!"],
  ] as const)("says the engine's %s detail as a sentence of its own", (reason, detail, words) => {
    expect(crewRefusalSentence(reason, detail)).toBe(words);
  });

  it("falls back to the reason's own sentence without a detail", () => {
    expect(crewRefusalSentence("wrong-state", "  ")).toBe("That can't be done right now.");
  });

  it("words every refusal reason as one sentence", () => {
    for (const reason of CrewRefusalReason.literals) {
      expect(crewRefusalSentence(reason, null), reason).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe("the drafts a crew surface hands the Mate", () => {
  it("asks for a local commit of the edits the crew's work waits on", () => {
    expect(crewCommitEditAsk(["src/ui/hud.ts"])).toBe(
      "Commit my edit to src/ui/hud.ts locally, without pushing: the crew's work waits to go into your code.",
    );
    expect(crewCommitEditAsk(["a.ts", "b.ts"])).toBe(
      "Commit my edits to a.ts and b.ts locally, without pushing: the crew's work waits to go into your code.",
    );
  });

  it("ships the crew's work that went in, and the Mate's own dirty paths", () => {
    expect(crewDeliverAsk(crew, [])).toBe(
      "Ship the work the crew added on appdev: Health endpoint for the load balancer.",
    );
    expect(crewDeliverAsk(crew, ["src/ui/hud.ts", "README.md"])).toBe(
      "Ship the work the crew added on appdev: Health endpoint for the load balancer. My own edits in src/ui/hud.ts and README.md ship too.",
    );
  });

  it("asks for crew ports as one range (PRD §5.7)", () => {
    expect(crewPortsAsk("appdev", [3001, 3002, 3003, 3004])).toBe(
      "Add crew ports 3001–3004 (httpSupport) to appdev's dev setup in zerops.yaml, self-deploy appdev, then make sure each new port is routed on the subdomain.",
    );
    expect(crewPortsAsk("appdev", [3001])).toBe(
      "Add crew port 3001 (httpSupport) to appdev's dev setup in zerops.yaml, self-deploy appdev, then make sure the new port is routed on the subdomain.",
    );
  });

  it("asks the Mate to suggest a crew from the goal", () => {
    expect(crewDescribeAsk("  a persistent world  ")).toBe(
      "Set up a crew for this project, from its goal: a persistent world",
    );
  });
});

describe("the chat's words", () => {
  it("says a copy's change", () => {
    expect(crewDiffStatWord({ insertions: 214, deletions: 12 })).toBe("+214 −12");
  });

  it("says a piece of work went into the Mate's code", () => {
    expect(crewWentInWord("Seasons", "Fen")).toBe("Seasons went into Fen's code");
    expect(crewWentInWord(null, "Fen")).toBe("Its work went into Fen's code");
  });

  it("says what isn't shipped, and short at a phone's width", () => {
    expect(crewNotShippedWords("Fen")).toBe("Fen hasn't shipped these yet");
    expect(CREW_NOT_SHIPPED_SHORT).toBe("Not shipped yet");
  });

  it("marks work that closed with nothing to add, by its title", () => {
    expect(crewClosedWord("Seasons", "Fen")).toBe(
      "Seasons closed with nothing to add to Fen's code",
    );
    expect(crewClosedWord(null, "Fen")).toBe("Its work closed with nothing to add to Fen's code");
  });

  it("invites a message to the crewmate in its chat's composer", () => {
    expect(crewMessagePlaceholder("Backend")).toBe("Message Backend…");
  });

  it.each([
    [{ brief: null, job: 5 }, "Its job changed. Its next message starts a fresh conversation."],
    [
      { brief: 5, job: null },
      "The crew's goal changed. Its next message starts a fresh conversation.",
    ],
    [
      { brief: 5, job: 6 },
      "Its job and the crew's goal changed. Its next message starts a fresh conversation.",
    ],
    [{ brief: null, job: null }, null],
  ] as const)("says what a changed job or goal does, with no version: %o", (pending, word) => {
    expect(crewPendingNotice(pending)).toBe(word);
  });

  it("points an earlier conversation at the current one, by name", () => {
    expect(crewEarlierStintNotice("Backend")).toEqual({
      text: "An earlier conversation with Backend — it goes on in a newer one.",
      sendBlock: "Write to Backend in its current conversation",
    });
  });
});

describe("crewDevHostDatabaseWord", () => {
  it.each([
    [true, "Has a database"],
    [false, "No database"],
    [null, "Database unknown"],
  ] as const)("says a dev service's database %s as %s", (database, word) => {
    expect(crewDevHostDatabaseWord(database)).toBe(word);
  });
});

describe("the conversation's line and a crewmate's menu", () => {
  it.each([
    { lead: false, says: ", one of Fen's crew" },
    { lead: true, says: ", Fen's lead — plans and reviews the crew's work" },
  ])("says who a face is after its name: $says", ({ lead, says }) => {
    expect(crewmateRoleWords("Fen", lead)).toBe(says);
  });

  it("names the Mate's own chat, for its face while another chat is open", () => {
    expect(mateOwnChatWord("Fen")).toBe("Fen's own chat");
  });

  it.each([
    {
      line: "Owns the world server under server/ and its tests.",
      says: "Owns the world server under server/ and its tests.",
    },
    {
      line: "How life in the harbour town works. Seasons, weather and trade.",
      says: "How life in the harbour town works.",
    },
    { line: "Is the build green? Then land it.", says: "Is the build green?" },
    { line: "**Owns** the `server/` tree. Tests first.", says: "Owns the server/ tree." },
    { line: "## Game rules", says: "Game rules" },
    {
      line: "- Keeps the [README](https://docs.example.test/readme) current",
      says: "Keeps the README current",
    },
    { line: "Owns index.ts and the v1.2 router", says: "Owns index.ts and the v1.2 router" },
    {
      line: "Keeps snake_case names and _emphasis_ apart.",
      says: "Keeps snake_case names and emphasis apart.",
    },
    { line: "   ", says: "" },
  ])("reads a job's first sentence in plain words: $line", ({ line, says }) => {
    expect(crewJobSentence(line, "World Server")).toBe(says);
  });

  // A job is written to the crewmate ("You own Game Rules: …"); the person
  // reads the line it gives them, not an instruction.
  it.each([
    {
      name: "Game Rules",
      line: "You own Game Rules: turns, scoring and their tests. Write the tests first.",
      says: "Turns, scoring and their tests.",
    },
    {
      name: "Game Rules",
      line: "You own Game Rules — turns, scoring and their tests.",
      says: "Turns, scoring and their tests.",
    },
    {
      name: "Game Rules",
      line: "You own game rules: turns, scoring and their tests.",
      says: "Turns, scoring and their tests.",
    },
    {
      name: "Game Rules",
      line: "You own the rules engine: turns, scoring and their tests.",
      says: "The rules engine: turns, scoring and their tests.",
    },
    {
      name: "C++ (core) [v2]*",
      line: "You own C++ (core) [v2]*: the engine's hot loop. Profile it first.",
      says: "The engine's hot loop.",
    },
    {
      name: "C++ (core) [v2]*",
      line: "You own C++ (core) [v2]* — the engine's hot loop.",
      says: "The engine's hot loop.",
    },
    {
      name: "Game Rules",
      line: "**You own Game Rules:** turns and scoring.",
      says: "Turns and scoring.",
    },
    { name: "Game Rules", line: "You own Game Rules:", says: "You own Game Rules:" },
    {
      name: "Game Rules",
      line: "You owned the rules engine once.",
      says: "You owned the rules engine once.",
    },
    {
      name: "Game Rules",
      line: "Owns the rules engine: turns, scoring and their tests.",
      says: "Owns the rules engine: turns, scoring and their tests.",
    },
  ])(
    "gives the person the line a job was written to its crewmate: $line",
    ({ name, line, says }) => {
      expect(crewJobSentence(line, name)).toBe(says);
    },
  );

  // The lead's job, and any other written to "you": the crewmate is who the line is about.
  it.each([
    {
      line: "You lead the Letopis crew: plans the work and splits it between the three.",
      says: "Leads the Letopis crew: plans the work and splits it between the three.",
    },
    {
      line: "You build the web client and its tests. Keep it fast.",
      says: "Builds the web client and its tests.",
    },
    { line: "You review every change for safety.", says: "Reviews every change for safety." },
    { line: "You lead", says: "You lead" },
    { line: "You leading nothing.", says: "You leading nothing." },
  ])("says a second-person job in the third person: $line", ({ line, says }) => {
    expect(crewJobSentence(line, "Lead")).toBe(says);
  });

  it("names the menus' presses and what each does", () => {
    expect(CREW_MENU).toEqual({
      tryWork: "Try its work",
      stopApp: "Stop its app",
      changeJob: "Change its job",
      changeGoal: "Change the goal",
      clearConversation: "Clear its conversation",
      removeFromCrew: "Remove from the crew",
      addCrewmate: "Add a crewmate",
      letItWork: "Let it work on its own…",
    });
    expect(crewTryWorkLine("Fen", "own")).toBe(
      "Opens its copy of the app. Nothing is in Fen's code yet.",
    );
    expect(crewTryWorkLine("Fen", "dev")).toBe(
      "Opens it at Fen's dev address. Nothing is in Fen's code yet.",
    );
    expect(CREW_MENU_LINES).toEqual({
      changeJob: "What it's responsible for.",
      changeGoal: "What the whole crew works toward.",
      clearConversation: "It keeps its job and its work.",
      addCrewmate: "Someone new, with a job of its own.",
      letItWork: "It carries on without asking, within your limits.",
    });
    expect(CREW_TRY_IT_WORD).toBe("Try it");
  });

  it.each([
    { press: "try", says: "Couldn't open Bo's work" },
    { press: "stop", says: "Couldn't stop Bo's app" },
    { press: "clear", says: "Couldn't clear Bo's conversation" },
  ] as const)("titles a refused press: $says", ({ press, says }) => {
    expect(crewMenuFailureWord(press, "Bo")).toBe(says);
  });
});

describe("a crewmate's empty conversation", () => {
  it("heads its job as the job view does, and the work it finished beside it", () => {
    expect(CREWMATE_EMPTY_WORDS).toEqual({ job: "Its job", work: "Its work" });
  });

  it("says what became of a piece of work after its title, as its chat's seam does", () => {
    expect(crewWentInOutcome("Fen")).toBe("went into Fen's code");
    expect(crewClosedOutcome("Fen")).toBe("closed with nothing to add to Fen's code");
    expect(crewWentInWord("Seasons", "Fen")).toBe(`Seasons ${crewWentInOutcome("Fen")}`);
    expect(crewClosedWord("Seasons", "Fen")).toBe(`Seasons ${crewClosedOutcome("Fen")}`);
  });

  it.each([
    { kind: "lead", says: "Fen's lead · plans and reviews the crew's work" },
    {
      kind: "writer",
      says: "One of Fen's crew · builds its part in its own copy of Fen's code",
    },
    { kind: "reader", says: "One of Fen's crew · checks the others' work and changes nothing" },
  ] as const)("says whose it is and what it does, under its name: $says", ({ kind, says }) => {
    expect(crewmateWhoseLine(kind, "Fen")).toBe(says);
  });

  it("says whose it is in a Mate's possessive", () => {
    expect(crewmateWhoseLine("lead", "Atlas")).toBe(
      "Atlas' lead · plans and reviews the crew's work",
    );
    expect(crewmateWhoseLine("writer", "Atlas")).toBe(
      "One of Atlas' crew · builds its part in its own copy of Atlas' code",
    );
  });

  // The lead's face on the conversation's line says what the lead does in the same words.
  it("says what a crewmate does as the line says the lead's", () => {
    expect(crewmateRoleWords("Fen", true)).toBe(
      `, Fen's lead — ${crewmateDoesWords("lead", "Fen")}`,
    );
  });

  it.each([
    {
      name: "Game Rules",
      line: "You own Game Rules: turns, scoring and their tests. Write the tests first.",
      says: "Turns, scoring and their tests. Write the tests first.",
    },
    {
      name: "Lead",
      line: "You lead the Letopis crew: Server and world, Game systems, Clients and creation.",
      says: "Leads the Letopis crew: Server and world, Game systems, Clients and creation.",
    },
    {
      name: "Referee",
      line: "You review every change: nothing may break a saved world. Ask before you block.",
      says: "Reviews every change: nothing may break a saved world.",
    },
    {
      name: "Lead",
      line: "You lead the Letopis crew: Server and world, Game systems. You read, plan and review; you never change files.",
      says: "Leads the Letopis crew: Server and world, Game systems.",
    },
    {
      name: "Game systems",
      line: "How life in the world works: seasons and growth. Its code is src/systems, with its tests. Keep your changes small.",
      says: "How life in the world works: seasons and growth. Its code is src/systems, with its tests.",
    },
    {
      name: "World Server",
      line: "How life in the harbour town works. Seasons, weather and trade.",
      says: "How life in the harbour town works. Seasons, weather and trade.",
    },
    {
      name: "World Server",
      line: "**Owns** the `server/` tree. Tests first.",
      says: "Owns the server/ tree. Tests first.",
    },
    {
      name: "World Server",
      line: "- Keeps the [README](https://docs.example.test/readme) current. Always.",
      says: "Keeps the README current. Always.",
    },
    { name: "World Server", line: "## Game rules", says: "Game rules" },
    {
      name: "Game Rules",
      line: "> > You own Game Rules: turns and scoring",
      says: "Turns and scoring",
    },
    // A callout's marker line, read as a Mate's message reads it: its word.
    { name: "World Server", line: "> [!WARNING]", says: "Warning:" },
    { name: "World Server", line: "   ", says: "" },
  ])(
    "reads a job's first line in plain words, leaving out what it says to its crewmate: $line",
    ({ name, line, says }) => {
      expect(crewJobLine(line, name)).toBe(says);
    },
  );
});

describe("crewRunsOnWord", () => {
  it.each([
    [
      { login: "Claude Code", model: "Haiku 4.5", effort: "high" },
      "Runs on Claude Code · Haiku 4.5 · high",
    ],
    [{ login: "Codex", model: null, effort: null }, "Runs on Codex"],
    [{ login: "work", model: "Opus 5.5", effort: null }, "Runs on work · Opus 5.5"],
  ] as const)("says what a crewmate runs on: %o", (runsOn, word) => {
    expect(crewRunsOnWord(runsOn)).toBe(word);
  });

  it("names the crewmates on a login by name, the lead as the lead", () => {
    expect(crewLoginRunsWord(["Lead", "Backend"], "Lead")).toBe("Runs: Lead, Backend");
    expect(crewLoginRunsWord(["Ada", "Backend"], "Ada")).toBe("Runs: Ada (lead), Backend");
    expect(crewLoginRunsWord(["Backend"], null)).toBe("Runs: Backend");
  });
});

describe("the crew's one line under its Mate", () => {
  it.each([
    { names: ["Bo"], says: "Bo needs you" },
    { names: ["Bo", "Cy"], says: "Bo and Cy need you" },
    { names: ["Bo", "Cy", "Dee"], says: "Bo and 2 others need you" },
    { names: ["Ada", "Bo", "Cy", "Dee"], says: "Ada and 3 others need you" },
  ])("says who needs you: $says", ({ names, says }) => {
    expect(crewLineNeedsWord(names)).toBe(says);
  });

  it.each([
    { names: ["Game systems"], says: "Game systems' work is ready" },
    { names: ["Bo", "Cy"], says: "2 pieces of work are ready" },
    { names: ["Bo", "Bo", "Cy"], says: "3 pieces of work are ready" },
  ])("says whose work waits for your review: $says", ({ names, says }) => {
    expect(crewLineReadyWord(names)).toBe(says);
  });

  it.each([
    { name: "Ada", lead: true, says: "Ada, the lead" },
    { name: "Bo", lead: false, says: "Bo" },
  ])("names a face: $says", ({ name, lead, says }) => {
    expect(crewFaceWord(name, lead)).toBe(says);
  });
});

describe("a crew closed to the viewer (D6)", () => {
  it("says it as the conversation does, the crew for its agent, its dash never starting a line", () => {
    expect(crewLockWords("someone-else")).toBe(
      "Signed in by another project member\u00a0— only they can run this crew.",
    );
    expect(crewLockWords("someone-else").replace("\u00a0", " ")).toBe(
      agentOwnershipComposerNotice("someone-else")?.replace("this agent", "this crew"),
    );
  });

  it("says unrecorded in the conversation's own words", () => {
    expect(crewLockWords("unrecorded")).toBe(agentOwnershipComposerNotice("unrecorded"));
  });

  it("offers the conversation's one way out", () => {
    expect(CREW_LOCK_ACTION).toBe(AGENT_OWNERSHIP_RECOVERY_LABEL);
  });
});
