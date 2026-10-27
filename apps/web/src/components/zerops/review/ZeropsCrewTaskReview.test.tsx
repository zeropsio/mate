/**
 * A crew task's review for a viewer who may not run its crewmate (D6): everything it says, and
 * no *Add to Fen's code* — its foot says why instead.
 */
import type { CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { CrewTask } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CrewTaskReviewView } from "./ZeropsCrewTaskReview";

const READY: CrewTask = {
  ...crewSnapshotFixture().board.tasks.find((task) => task.id === "task-12")!,
  state: "ready",
  check: { state: "passed", output: "Tests  48 passed (48)" },
};

const LOCK: CrewLock = { login: "claudeAgent", agentId: "claude-code", ownership: "someone-else" };

const render = (task: CrewTask, lock: CrewLock | null) =>
  renderToStaticMarkup(
    <CrewTaskReviewView
      conflicts={[]}
      face={{ name: "Backend", tint: "sky", face: "done" }}
      lock={lock}
      mateName="Fen"
      onAsk={() => undefined}
      onClose={() => undefined}
      onLand={() => undefined}
      press={{ kind: "idle" }}
      task={task}
    />,
  );

/** The visible text, tags stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/ /gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

describe("CrewTaskReviewView — for a viewer who may not run the crewmate (D6)", () => {
  it("offers the person who runs it Add to Fen's code", () => {
    const html = render(READY, null);
    expect(html).toContain("data-review-primary");
    expect(textOf(html)).toContain("Add to Fen's code");
  });

  it("reads the work without its press, the foot saying why", () => {
    const html = render(READY, LOCK);
    const text = textOf(html);
    expect(html).not.toContain("data-review-primary");
    expect(text).toContain(READY.title);
    expect(text).toContain("Signed in by another project member — only they can run this crew.");
    expect(text).toContain("Close");
    expect(text).not.toContain("Cancel");
  });

  it("says of work that went in what it always says", () => {
    const landed: CrewTask = { ...READY, state: "landed", landedCommit: "5e1a2b7" };
    expect(textOf(render(landed, LOCK))).toBe(textOf(render(landed, null)));
  });
});
