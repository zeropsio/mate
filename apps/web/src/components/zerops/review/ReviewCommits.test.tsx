import { markupDom } from "../../../../test/markupDom";
/**
 * The commits a change squashes, one line each — what it did, its age and its hash on the right
 * edge — a long run folded after its newest five, the rows' room held while they are read.
 */
import type { ChangeReadoutCommit } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ReadoutPart } from "~/zerops/useZeropsChangeDetail";

import { ReviewCommits } from "./ReviewCommits";

const NOW = Date.parse("2026-09-29T12:00:00Z");

function commits(count: number): ReadoutPart<ReadonlyArray<ChangeReadoutCommit>> {
  return {
    kind: "read",
    value: Array.from({ length: count }, (_, index) => ({
      sha: `${String(index).padStart(7, "0")}${"a".repeat(33)}`,
      subject: `Commit number ${String(index)}`,
      at: new Date(NOW - (index + 1) * 60 * 60_000).toISOString(),
    })),
  };
}

function html(part: ReadoutPart<ReadonlyArray<ChangeReadoutCommit>>, onRetry?: () => void): string {
  return renderToStaticMarkup(<ReviewCommits commits={part} now={NOW} onRetry={onRetry} />);
}

describe("a change's commits in its review", () => {
  it("draws each on one line: what it did, then its age and its hash", () => {
    const markup = html(commits(1));
    const row = markupDom(markup).querySelector("li");
    expect(row?.textContent).toBe("Commit number 01h0000000");
    expect(row?.querySelector("code")?.textContent).toBe("0000000");
  });

  it.each([
    ["a short run whole", 7, 7, undefined],
    ["a long run's newest five, with the way to all of them", 19, 5, "Show all 19"],
  ] as const)("shows %s", (_case, count, shown, fold) => {
    const markup = html(commits(count));
    expect(markupDom(markup).querySelectorAll("li")).toHaveLength(shown);
    expect(markup.includes("Show all")).toBe(fold !== undefined);
    if (fold !== undefined) expect(markup).toContain(fold);
    expect(markup).toContain(`<span>${String(count)}</span>`);
  });

  it("says they could not be read, with Try again where it can try", () => {
    const failed = { kind: "failed", reason: "HQ is not answering right now." } as const;
    expect(html(failed, () => {})).toContain(">Try again</button>");
    expect(html(failed)).not.toContain("Try again");
    expect(html(failed)).toContain("The commits couldn&#x27;t be read.");
  });

  it.each([
    ["nothing read for it", { kind: "none" } as const],
    ["no commits at all", commits(0)],
  ])("shows no section for %s", (_case, part) => {
    expect(html(part)).toBe("");
  });
});
