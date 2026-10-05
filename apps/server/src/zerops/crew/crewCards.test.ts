import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";
import { describe, expect, it } from "@effect/vitest";

import {
  afterLandCard,
  claimReleaseCard,
  carriedCard,
  claimStartCard,
  continueCard,
  fixCard,
  resolveCard,
  rotationSeed,
  savedSeamWords,
  sweptSeamWords,
  stintReasonWords,
  taskCard,
} from "./crewCards.ts";

const TASK = { number: 12, title: "Camera rig" } as const;

describe("crew cards", () => {
  it.each([
    [
      "a task you created: title line, Done when, then the brief",
      taskCard({
        ...TASK,
        source: "you",
        card: {
          brief: "Follow the player.",
          doneWhen: "the camera follows the player; `npm test` passes",
          note: null,
        },
        resetTo: null,
      }),
      [
        CREW_CARD_OPENER,
        "#12 Camera rig · from you",
        "Done when: the camera follows the player; `npm test` passes",
        "",
        "Follow the player.",
      ].join("\n"),
    ],
    [
      "a message's task, one of a fan-out, on a copy reset to your tree",
      taskCard({
        ...TASK,
        source: "message",
        card: {
          brief: "Rework @backend to X, @frontend does Y",
          doneWhen: "",
          note: "Also sent to @frontend. Your part is what is addressed to @backend.",
        },
        resetTo: "a1b2c3d4e5f6",
      }),
      [
        CREW_CARD_OPENER,
        "#12 Camera rig · from your message",
        "Also sent to @frontend. Your part is what is addressed to @backend.",
        "Your copy starts again from your tree's head (a1b2c3d).",
        "",
        "Rework @backend to X, @frontend does Y",
      ].join("\n"),
    ],
    [
      "continue after a job change",
      continueCard({ ...TASK, change: { kind: "job", version: 5 } }),
      [
        CREW_CARD_OPENER,
        "#12 Camera rig · continue",
        "Your job changed (v5), so this is a new conversation. Continue your task from your copy and its history.",
      ].join("\n"),
    ],
    [
      "resolve the conflicts a merge-in stopped on",
      resolveCard({ ...TASK, paths: ["src/api/items.ts", "src/ui/hud.ts"] }),
      [
        CREW_CARD_OPENER,
        "#12 Camera rig · resolve the conflicts",
        "Merging your tree's head into your copy stopped on conflicts in:",
        "- src/api/items.ts",
        "- src/ui/hud.ts",
        "Resolve them in your copy, keeping what both sides meant. The merge is committed once no conflict marker is left; then report with crew_report.",
      ].join("\n"),
    ],
    [
      "fix a failed check",
      fixCard({ ...TASK, command: "npm test", output: "1 failing\n" }),
      [
        CREW_CARD_OPENER,
        "#12 Camera rig · fix the check",
        "The check (npm test) failed on the tree that would land:",
        "```",
        "1 failing",
        "```",
        "Fix it in your copy, then report with crew_report.",
      ].join("\n"),
    ],
    [
      "restart the dev server after a landing",
      afterLandCard({
        ...TASK,
        commit: "a1b2c3d4e5f6",
        host: "appdev",
        devServer: { port: 3000, command: "npm run dev" },
      }),
      [
        CREW_CARD_OPENER,
        "#12 Camera rig · restart the dev server",
        'Your task landed as a1b2c3d. Restart appdev\'s dev server from the tree with zerops_dev_server: action=restart hostname=appdev port=3000 processMatch="npm run dev", no workDir. Nothing else.',
      ].join("\n"),
    ],
    [
      "show the copy on dev once the person granted it",
      claimStartCard({
        host: "appdev",
        devServer: { port: 3000, command: "npm run dev" },
        workDir: "/var/www/.crew/backend",
      }),
      [
        CREW_CARD_OPENER,
        "Show your work on appdev",
        'The person lets appdev\'s dev server run from your copy. Restart it with zerops_dev_server: action=restart hostname=appdev port=3000 processMatch="npm run dev" command="npm run dev" workDir=/var/www/.crew/backend. Nothing else.',
      ].join("\n"),
    ],
    [
      "give dev back to the tree",
      claimReleaseCard({ host: "appdev", devServer: { port: 3000, command: "npm run dev" } }),
      [
        CREW_CARD_OPENER,
        "Give appdev back",
        "appdev's dev server goes back to the person's tree. Restart it with zerops_dev_server: action=restart hostname=appdev port=3000 processMatch=\"npm run dev\", no workDir. Nothing else.",
      ].join("\n"),
    ],
  ])("%s", (_, text, expected) => {
    expect(text).toBe(expected);
  });

  it("seeds a new conversation from the open task, the copy's commits and the last report", () => {
    expect(
      rotationSeed({
        handle: "backend",
        reason: "prompt-changed",
        task: {
          ...TASK,
          card: { brief: "Follow the player.", doneWhen: "", note: null },
          report: "Camera follows; jitter left.",
        },
        commits: ["a1b2c3d wip(t-1): turn 2", "b2c3d4e wip(t-1): turn 1"],
      }),
    ).toBe(
      [
        "This is a new conversation for @backend: the brief or your job changed. Your copy of the code and its history carry on.",
        "",
        "You are working on #12 Camera rig:",
        "Follow the player.",
        "",
        "Commits in your copy since the task started:",
        "a1b2c3d wip(t-1): turn 2",
        "b2c3d4e wip(t-1): turn 1",
        "",
        "Your last report: Camera follows; jitter left.",
      ].join("\n"),
    );
    expect(rotationSeed({ handle: "erik", reason: "start-fresh", task: null, commits: [] })).toBe(
      "This is a new conversation for @erik: the person started you fresh. Your copy of the code and its history carry on.",
    );
  });

  it.each([
    ["start-fresh", { brief: 1, job: 1 }, { brief: 1, job: 1 }, "You cleared its conversation"],
    ["prompt-changed", { brief: 1, job: 4 }, { brief: 1, job: 5 }, "Its job changed"],
    ["prompt-changed", { brief: 3, job: 2 }, { brief: 4, job: 2 }, "The crew's goal changed"],
    [
      "prompt-changed",
      { brief: 3, job: 2 },
      { brief: 4, job: 3 },
      "The crew's goal and its job changed",
    ],
    [
      "login-changed",
      { brief: 1, job: 1 },
      { brief: 1, job: 1 },
      "It runs on a different login now",
    ],
    [
      "fresh-task",
      { brief: 1, job: 1 },
      { brief: 1, job: 1 },
      "A fresh conversation for unrelated work",
    ],
    [
      "principal-changed",
      { brief: 1, job: 1 },
      { brief: 1, job: 1 },
      "A fresh conversation for someone else's work",
    ],
    [
      "second-rework",
      { brief: 1, job: 1 },
      { brief: 1, job: 1 },
      "A fresh conversation: its work came back a second time",
    ],
    [
      "compactions",
      { brief: 1, job: 1 },
      { brief: 1, job: 1 },
      "A fresh conversation, carried on from memory",
    ],
    [
      "context-overflow",
      { brief: 1, job: 1 },
      { brief: 1, job: 1 },
      "A fresh conversation: the last one grew too long",
    ],
    [
      "resume-failed",
      { brief: 1, job: 1 },
      { brief: 1, job: 1 },
      "A fresh conversation: the last one couldn't be resumed",
    ],
  ] as const)(
    "a stint opened for %s reads as its seam line, with no version",
    (reason, running, current, expected) => {
      expect(stintReasonWords(reason, running, current)).toBe(expected);
    },
  );

  it.each([
    [
      { kind: "job", version: 5 },
      "prompt-changed",
      "nextTurn",
      "Its job changed — from its next message",
    ],
    [
      { kind: "brief", version: 4 },
      "prompt-changed",
      "now",
      "The crew's goal changed — from now on",
    ],
    [
      { kind: "job", version: 5 },
      "prompt-changed",
      "fresh",
      "Its job changed — its next message starts a fresh conversation",
    ],
    [
      { kind: "job", version: 5 },
      "login-changed",
      "fresh",
      "It runs on a different login now — its next message starts a fresh conversation",
    ],
  ] as const)(
    "a %o save (%s, %s) leaves its seam line in the person's words",
    (change, reason, apply, expected) => {
      expect(savedSeamWords(change, reason, apply)).toBe(expected);
    },
  );

  // The boot sweep's save, said where the person reads the crewmate: what it saved, and where.
  it.each([
    [
      ["src/api.ts"],
      "Saved what the restart left uncommitted on crew/backend as 0a84078: src/api.ts",
    ],
    [
      ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
      "Saved what the restart left uncommitted on crew/backend as 0a84078: a.ts, b.ts, c.ts and 2 more",
    ],
  ] as const)("a boot sweep's save of %o leaves its seam line", (paths, expected) => {
    expect(sweptSeamWords("crew/backend", "0a84078f2fd5652d10c3c820786c944d057386e3", paths)).toBe(
      expected,
    );
  });

  it("carries the open task into a new conversation's first turn", () => {
    expect(
      carriedCard({
        ...TASK,
        reason: "Its job changed",
        text: "Now also sort them.",
      }),
    ).toBe(
      [
        CREW_CARD_OPENER,
        "#12 Camera rig · continues",
        "Its job changed",
        "",
        "Now also sort them.",
      ].join("\n"),
    );
  });
});
