import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsMergeConfirm } from "./ZeropsMergeDialog";

const LONG_TITLE = "Cache the link previews so the list stops flickering when you scroll it fast";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 5,
    title: LONG_TITLE,
    kind: "code",
    mateProjectId: "p-theo",
    author: "mate-p-theo",
    url: undefined,
    checks: "passing",
    checkWord: "checks passed",
    mergeable: true,
    merged: false,
  mergedAt: undefined,
    headSha: "b21d904c",
    baseBranch: "main",
    line: "appdev #5",
    updatedAt: undefined,
    ...over,
  };
}

function render(props: Partial<Parameters<typeof ZeropsMergeConfirm>[0]> = {}) {
  // The title and the way out are Base UI's, and both need the root's context.
  return renderToStaticMarkup(
    <Dialog open onOpenChange={() => {}}>
      <ZeropsMergeConfirm
        mateName="Theo"
        merging={false}
        onConfirm={() => {}}
        pull={pull()}
        {...props}
      />
    </Dialog>,
  );
}

describe("the merge confirm", () => {
  it("names the change it would land, so the verb is not pressed blind", () => {
    expect(render()).toContain("Merge #5");
  });

  it("spells the whole title out, which the menu row truncates", () => {
    // The row this verb sits on shows `…lo by Mat…` and nothing more.
    expect(render()).toContain(LONG_TITLE);
  });

  it("says the number once and the author once", () => {
    const html = render({
      mateName: undefined,
      pull: pull({ mateProjectId: undefined, author: "ada", title: "Bump the linter" }),
    });
    expect(html.match(/#5/gu)?.length).toBe(1);
    expect(html.match(/ada/gu)?.length).toBe(1);
  });

  it("says what merging sets in motion, because a squash cannot be rolled back", () => {
    expect(render()).toContain("It squashes onto main, and the stage runs what main says.");
  });

  it("says a recipe change changes the environments rather than deploying one", () => {
    expect(render({ pull: pull({ kind: "recipe", repository: "group" }) })).toContain(
      "changes what this project&#x27;s environments are made of",
    );
  });

  it("carries the checks into the question, since they are the reason to hesitate", () => {
    expect(render({ pull: pull({ checks: "failing", checkWord: "checks failed" }) })).toContain(
      "checks failed",
    );
  });

  it("names the Mate that wrote it", () => {
    expect(render()).toContain("Theo");
  });

  it("never shows a bot login where the Mate cannot be named", () => {
    const html = render({ mateName: undefined });
    expect(html).not.toContain("mate-p-theo");
    expect(html).not.toContain("Written by");
  });

  it("names a person by their own login, which is not a bot's", () => {
    const html = render({
      mateName: undefined,
      pull: pull({ mateProjectId: undefined, author: "ales" }),
    });
    expect(html).toContain("Written by");
    expect(html).toContain("ales");
  });

  it("takes no second press while the forge is working", () => {
    expect(render({ merging: true })).toContain("Merging");
  });
});
