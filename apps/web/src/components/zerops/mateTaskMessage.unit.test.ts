import type { MateTaskMessage, MateTaskSource } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { taskMessageOrigin } from "./mateTaskMessage.logic.ts";

const BOARD: MateTaskSource = { kind: "board", putBy: "u-ales", title: "Pick a number" };
const SLACK: MateTaskSource = {
  kind: "slack-thread",
  workspace: "Tea Shop",
  channel: "support",
  url: "https://tea-shop.slack.com/archives/C1/p2",
  title: "The receipt shows the wrong address",
  author: "Ines",
};
const ISSUE: MateTaskSource = {
  kind: "github-issue",
  repo: "acme/tea-shop",
  number: 12,
  url: "https://github.com/acme/tea-shop/issues/12",
  title: "Fix the checkout total",
  author: "nova-dev",
};

const said = (from: MateTaskMessage["from"], author: string | null) => ({ from, author });

// witness: apps/web/src/components/zerops/mateTaskMessage.logic.ts | return { by, act: "answered", where: "board", to: { kind: "board" } }; → return { by, act: "answered", where: "board", to: { kind: "none" } };
it("MN+2: A follow-up says whether the reader wrote it, and leads to where it was said: an answer to a Board, conversation, webhook or schedule task to its panel on the Board, a thread reply to the thread, an issue comment or edit to the issue, a review comment nowhere; breaks: the reader's own answer reads as a stranger's 'replied in the thread', linked nowhere", () => {
  const viewer = ["Ales Rechtorik"];
  const rows = [
    [said("reply", "Ales Rechtorik"), BOARD, "you", "board", { kind: "board" }],
    [said("reply", "Rhea"), BOARD, "named", "board", { kind: "board" }],
    [said("comment", null), null, "someone", "board", { kind: "board" }],
    [said("reply", "Ines"), SLACK, "named", "slack-thread", { kind: "url", url: SLACK.url }],
    [said("comment", "ida-ops"), ISSUE, "named", "issue", { kind: "url", url: ISSUE.url }],
    [said("edit", "nova-dev"), ISSUE, "named", "issue", { kind: "url", url: ISSUE.url }],
    [said("edit", "Rhea"), BOARD, "named", "task", { kind: "none" }],
    [said("review", "Ales Rechtorik"), ISSUE, "you", "change", { kind: "none" }],
  ] as const;
  for (const [message, source, by, where, to] of rows) {
    const origin = taskMessageOrigin(message, source, viewer);
    expect([origin.by.kind, origin.where, origin.to]).toEqual([by, where, to]);
  }
});
