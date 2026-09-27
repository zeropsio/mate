import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";
import { describe, expect, it } from "@effect/vitest";

import {
  afterLandCard,
  claimReleaseCard,
  claimStartCard,
  continueCard,
  fixCard,
  resolveCard,
  rotationSeed,
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
});
