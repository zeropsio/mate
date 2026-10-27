import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { PutLiveRun } from "~/zerops/putLive.logic";

import { visitElements } from "../../test/reactElementTree";
import { Button } from "../ui/button";
import { PutLiveRow, type PutLiveRowProps } from "./ProductionRun";
import { ZeropsNextStepStrip, type ZeropsNextStepStripModel } from "./ZeropsNextStepBanner";

const RUN: PutLiveRun = {
  orgId: "o-1",
  groupId: "g-1",
  project: "Tea Shop",
  phase: "creating",
};

const row = (run: Partial<PutLiveRun>, over: Partial<PutLiveRowProps> = {}) =>
  renderToStaticMarkup(
    <PutLiveRow
      address={undefined}
      copied={false}
      nowMs={0}
      onAgain={() => {}}
      onCopy={() => {}}
      onDismiss={() => {}}
      onOpenProject={() => {}}
      run={{ ...RUN, ...run }}
      {...over}
    />,
  );

describe("a release on its way, on its project's production", () => {
  it("says a step that never answered in plain words, with its source's words under Details", () => {
    const markup = row({
      phase: "failed",
      failedAt: "creating",
      failure: { words: "No answer came back.", action: "again", detail: "socket hang up" },
    });
    expect(markup).toContain("No answer came back.");
    expect(markup).toContain("Details");
    expect(markup).toContain(">Try again<");
  });

  it("shows the run as one wait row whose step words replace each other in place", () => {
    const making = row({ phase: "creating" });
    expect(making).toContain('data-zerops-production-run="progress"');
    expect(making).toContain("Putting Tea Shop live");
    expect(making).toContain("Making production");

    const releasing = row({ phase: "releasing", tag: "v0.1.0" });
    expect(releasing).toContain("Releasing v0.1.0");
    expect(releasing).not.toContain("Making production");
  });

  it("ends on the live app: its address large and the way in, Copy link, and the release it runs", () => {
    const markup = row(
      { phase: "live", tag: "v0.1.0", productionId: "p-prod", liveAt: 0 },
      {
        address: {
          url: "https://app-abcd-3000.prg1.zerops.app",
          host: "app-abcd-3000.prg1.zerops.app",
        },
      },
    );
    expect(markup).toContain('data-zerops-production-run="live"');
    expect(markup).toContain('href="https://app-abcd-3000.prg1.zerops.app"');
    expect(markup).toContain(">app-abcd-3000.prg1.zerops.app<");
    expect(markup).toContain("Copy link");
    expect(markup).toContain("Released v0.1.0 · just now");
  });

  it("shows how long Making production has run, so a long wait reads as one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    try {
      const making = row({ phase: "creating", stepAt: 58_000 });
      expect(making).toContain("Making production");
      expect(making).toContain("0:42");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers the project beside Try again once production is made but its services never showed ready", () => {
    const props: PutLiveRowProps = {
      address: undefined,
      copied: false,
      nowMs: 0,
      onAgain: vi.fn(),
      onCopy: () => {},
      onDismiss: () => {},
      onOpenProject: vi.fn(),
      run: {
        ...RUN,
        phase: "failed",
        failedAt: "creating",
        productionId: "p-prod",
        failure: {
          words: "Zerops hasn't shown the new services ready after 10 minutes.",
          action: "again",
          alsoProject: true,
        },
      },
    };
    const markup = renderToStaticMarkup(<PutLiveRow {...props} />);
    expect(markup).toContain("Zerops hasn&#x27;t shown the new services ready after 10 minutes.");
    const press = (label: string) => {
      const button = visitElements(
        PutLiveRow(props),
        (element) => element.type === Button && element.props.children === label,
      );
      const onClick = button?.props.onClick;
      if (typeof onClick !== "function") throw new Error(`No ${label} button`);
      onClick();
    };
    press("Try again");
    expect(props.onAgain).toHaveBeenCalledOnce();
    press("Open the project");
    expect(props.onOpenProject).toHaveBeenCalledOnce();
  });

  it("After a reload, production made and not released says so, and Release is its one press", () => {
    const onAgain = vi.fn();
    const props: PutLiveRowProps = {
      address: undefined,
      copied: false,
      nowMs: 0,
      onAgain,
      onCopy: () => {},
      onDismiss: () => {},
      onOpenProject: () => {},
      run: {
        ...RUN,
        phase: "failed",
        failedAt: "creating",
        productionId: "p-prod",
        failure: { words: "Production is made; v0.1.0 isn't released yet.", action: "release" },
      },
    };
    const markup = renderToStaticMarkup(<PutLiveRow {...props} />);
    expect(markup).toContain("Production is made; v0.1.0 isn&#x27;t released yet.");
    expect(onAgain).not.toHaveBeenCalled();
    const release = visitElements(
      PutLiveRow(props),
      (element) => element.type === Button && element.props.children === "Release",
    );
    const onClick = release?.props.onClick;
    if (typeof onClick !== "function") throw new Error("No Release button");
    onClick();
    expect(onAgain).toHaveBeenCalledOnce();
  });

  it.each([
    ["again", "Try again"],
    ["project", "Open the project"],
    ["release", "Release"],
  ] as const)("says why it stopped, with the one action that fixes it (%s)", (action, label) => {
    const markup = row({
      phase: "failed",
      failedAt: "creating",
      failure: { words: "Zerops needs more credit.", action },
    });
    expect(markup).toContain("Tea Shop isn&#x27;t live yet");
    expect(markup).toContain("Zerops needs more credit.");
    expect(markup).toContain(`>${label}<`);
  });
});

describe("the change waiting, while the project has no production", () => {
  const STRIP: ZeropsNextStepStripModel = {
    title: "Nova is waiting for your review of #1",
    detail: "Shop front",
    tint: "coral",
    target: { kind: "change", groupId: "g-1", repository: "app", number: 1 },
  };

  // The owner, 2026-10-18: "it's just merge into git, none says its connected to prod".
  it("offers Review as its one button, never Put it live: a change's door is its merge", () => {
    const markup = renderToStaticMarkup(<ZeropsNextStepStrip onReview={() => {}} strip={STRIP} />);
    expect(markup).toContain(">Review<");
    expect(markup).not.toContain("Put it live");
  });

  it("keeps Review as its one button once a production exists", () => {
    const markup = renderToStaticMarkup(<ZeropsNextStepStrip onReview={() => {}} strip={STRIP} />);
    expect(markup).not.toContain("Put it live");
  });
});
