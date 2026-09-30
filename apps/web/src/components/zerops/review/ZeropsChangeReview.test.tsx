/**
 * A change's review once it merged, drawn with its reads handed in: a recipe change says what its
 * merge did to the project's environments, from the files it changed, and never offers a release;
 * a code change still hands over to the release production waits for.
 */
import type { FlowPullRequest, GiteaChangedFile } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChangeReviewView, type ChangeReviewViewProps } from "./ZeropsChangeReview";

const NOW = Date.parse("2026-09-30T10:00:00Z");
const noop = () => undefined;

function merged(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 7,
    title: "Add a mail service",
    kind: "code",
    mateProjectId: undefined,
    author: "ada",
    url: undefined,
    checks: "none",
    checkWord: undefined,
    mergeability: "mergeable",
    merged: true,
    mergedAt: new Date(NOW).toISOString(),
    headSha: "c".repeat(40),
    baseBranch: "main",
    line: "appdev #7 · ada",
    updatedAt: undefined,
    ...over,
  };
}

const recipe = merged({ repository: "group", kind: "recipe", line: "#7 · ada" });

const changed = (filename: string): GiteaChangedFile => ({
  filename,
  previousFilename: undefined,
  status: "modified",
  additions: 6,
  deletions: 0,
});

/** The review of `pull` in a project with a stage and a production two changes behind `main`. */
function render(pull: FlowPullRequest, files: ReadonlyArray<GiteaChangedFile>): string {
  const props: ChangeReviewViewProps = {
    pull,
    mate: undefined,
    readout: {
      files: { kind: "read", value: files },
      diff: { kind: "none" },
      commits: { kind: "read", value: [] },
      mainSince: { kind: "none" },
    },
    comments: {
      state: { kind: "read", comments: [] },
      say: async () => null,
      saying: false,
      retry: noop,
    },
    remarks: [],
    run: { words: undefined, reading: false },
    giteaOrigin: undefined,
    pictures: undefined,
    environments: [{ tier: "stage" }, { tier: "production" }],
    waitingForProduction: 2,
    live: "v0.1.0",
    press: { kind: "idle" },
    now: NOW,
    onMerge: noop,
    onFix: noop,
    onAsk: async () => undefined,
    onOpenRun: undefined,
    onReviewRelease: noop,
    onClose: noop,
  };
  return renderToStaticMarkup(<ChangeReviewView {...props} />);
}

/** The visible text, tags stripped, whitespace folded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();

describe("ChangeReviewView: a change after its merge", () => {
  it.each([
    [
      "a recipe change to recipes nothing in the project is made from",
      [changed("1 — Remote (CDE)/import.yaml"), changed("2 — Local/import.yaml")],
      "Just now · no environment changes",
      "Nothing in this project is made from the Remote (CDE) or Local recipe, so no environment changes.",
    ],
    [
      "a recipe change to the stage's recipe",
      [changed("3 — Stage/import.yaml"), changed("3 — Stage/README.md")],
      "Just now · the stage gets any new service",
      "The stage gets any service added to its recipe, created empty; the services it has stay as they are.",
    ],
  ])("%s says what it did, and offers no release", (_case, files, why, consequence) => {
    const html = render(recipe, files);
    const text = textOf(html);
    expect(text).toContain(`Merged into main ${why}`);
    expect(text).toContain(consequence);
    expect(html).not.toContain("data-review-primary");
    expect(text).not.toContain("Review release");
  });

  it("a code change hands over to the release production waits for", () => {
    const html = render(merged(), [changed("src/mail.ts")]);
    expect(textOf(html)).toContain("Production still serves v0.1.0 until you release.");
    expect(html).toContain('data-zerops-primary-action="Review release"');
  });
});
