import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";

import type { ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import type { ComposerBannerStackItem } from "../chat/ComposerBannerStack";
import { zeropsNextStepBannerItem } from "./ZeropsNextStepBanner";

const PULL: FlowPullRequest = {
  repository: "app",
  number: 1,
  title: "Greet with a fuller line",
  kind: "code",
  mateProjectId: "p-wren",
  author: "mate-p-wren",
  url: undefined,
  checks: "none",
  checkWord: undefined,
  mergeable: true,
  merged: false,
  mergedAt: undefined,
  headSha: "abc",
  baseBranch: "main",
  line: "app #1",
  updatedAt: undefined,
};

function nextStep(over: Partial<ZeropsMateNextStep>): ZeropsMateNextStep {
  return {
    step: { kind: "none" },
    groupId: "g",
    running: false,
    trouble: null,
    merge: () => undefined,
    release: () => undefined,
    releaseContents: [],
    ...over,
  };
}

const CONTROLS = {
  confirmOpen: false,
  setConfirmOpen: () => undefined,
  openProject: () => undefined,
};

function actionsOf(item: ComposerBannerStackItem | null): unknown {
  if (item === null) throw new Error("no banner");
  return item.actions;
}

const MERGE: ZeropsMateNextStep["step"] = {
  kind: "merge",
  pull: PULL,
  title: "Wren is waiting on you to merge #1.",
  verb: "Merge",
  running: "Merging…",
};

describe("zeropsNextStepBannerItem", () => {
  it("offers this Mate's merge under the pull request's title", () => {
    const item = zeropsNextStepBannerItem(nextStep({ step: MERGE }), CONTROLS);
    expect(item).toMatchObject({
      id: "mate-next-step:merge:app#1",
      variant: "info",
      title: "Wren is waiting on you to merge #1.",
      description: "Greet with a fuller line",
    });
    expect(renderToStaticMarkup(<>{item?.actions}</>)).toContain(">Merge<");
  });

  it("says a refusal in its own words and takes no second click while the verb runs", () => {
    const item = zeropsNextStepBannerItem(
      nextStep({ step: MERGE, trouble: "Gitea: not mergeable", running: true }),
      CONTROLS,
    );
    expect(item).toMatchObject({ variant: "error", description: "Gitea: not mergeable" });
    const html = renderToStaticMarkup(<>{item?.actions}</>);
    expect(html).toContain(">Merging…<");
    expect(html).toContain("disabled");
  });

  it("asks before a release, and releases only once the person confirms", () => {
    const opened: boolean[] = [];
    let released = 0;
    const item = zeropsNextStepBannerItem(
      nextStep({
        step: {
          kind: "release",
          tag: "v0.2.0",
          waiting: 2,
          title: "Release v0.2.0 to production",
          verb: "Release v0.2.0",
          running: "Releasing…",
        },
        release: () => {
          released += 1;
        },
      }),
      { ...CONTROLS, setConfirmOpen: (open) => opened.push(open) },
    );
    expect(item).toMatchObject({
      id: "mate-next-step:release:g",
      variant: "info",
      title: "Release v0.2.0 to production",
      description: "2 changes ready to go live.",
    });
    const [verb, dialog] = (actionsOf(item) as ReactElement<{ children: ReactElement[] }>).props
      .children as [
      ReactElement<{ onClick: () => void }>,
      ReactElement<{ onConfirm: () => void; open: boolean; tag: string }>,
    ];
    expect(dialog.props).toMatchObject({ open: false, tag: "v0.2.0" });
    verb.props.onClick();
    expect(opened).toEqual([true]);
    expect(released).toBe(0);
    dialog.props.onConfirm();
    expect(opened).toEqual([true, false]);
    expect(released).toBe(1);
  });

  it("sends Add production to the project on the projects page", () => {
    const opened: string[] = [];
    const item = zeropsNextStepBannerItem(
      nextStep({
        step: {
          kind: "add-production",
          title: "main has code, no production yet",
          detail: "Add it from the project's recipe; releases go there.",
          verb: "Add production",
        },
      }),
      { ...CONTROLS, openProject: (groupId) => opened.push(groupId) },
    );
    expect(item).toMatchObject({
      id: "mate-next-step:add-production:g",
      variant: "info",
      title: "main has code, no production yet",
      description: "Add it from the project's recipe; releases go there.",
    });
    (actionsOf(item) as ReactElement<{ onClick: () => void }>).props.onClick();
    expect(opened).toEqual(["g"]);
  });

  it("draws nothing where the flow asks nothing of this conversation", () => {
    expect(zeropsNextStepBannerItem(nextStep({}), CONTROLS)).toBeNull();
  });
});
