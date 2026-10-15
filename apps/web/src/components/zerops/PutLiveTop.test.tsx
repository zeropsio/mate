import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { PutLiveRun } from "~/zerops/putLive.logic";

import { PutLiveRow, type PutLiveRowProps } from "./PutLiveTop";
import { ZeropsNextStepStrip, type ZeropsNextStepStripModel } from "./ZeropsNextStepBanner";

const RUN: PutLiveRun = {
  groupId: "g-1",
  project: "Tea Shop",
  change: { repository: "app", number: 1, title: "Shop front", head: "abc", merged: true },
  phase: "creating",
};

const row = (run: Partial<PutLiveRun>, over: Partial<PutLiveRowProps> = {}) =>
  renderToStaticMarkup(
    <PutLiveRow
      address={undefined}
      copied={false}
      face={{ tint: "coral" }}
      nowMs={0}
      onAgain={() => {}}
      onCopy={() => {}}
      onDismiss={() => {}}
      onOpenProject={() => {}}
      onSeeCode={() => {}}
      run={{ ...RUN, ...run }}
      {...over}
    />,
  );

describe("Put it live in the conversation", () => {
  it("shows the run as one wait row whose step words replace each other in place", () => {
    const making = row({ phase: "creating" });
    expect(making).toContain('data-composer-top="live-progress"');
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
    expect(markup).toContain('data-composer-top="live"');
    expect(markup).toContain('href="https://app-abcd-3000.prg1.zerops.app"');
    expect(markup).toContain(">app-abcd-3000.prg1.zerops.app<");
    expect(markup).toContain("Copy link");
    expect(markup).toContain("Released v0.1.0 · just now");
  });

  it.each([
    ["again", "Try again"],
    ["see-code", "See the code"],
    ["project", "Open the project"],
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

  it("offers Put it live as the one blue button, with Review beside it in quiet words", () => {
    const onPutLive = vi.fn();
    const markup = renderToStaticMarkup(
      <ZeropsNextStepStrip onPutLive={onPutLive} onReview={() => {}} strip={STRIP} />,
    );
    expect(markup).toContain(">Put it live<");
    expect(markup).toContain(">Review<");
    expect(markup.match(/composer-top-button/gu)).toHaveLength(1);
  });

  it("keeps Review as its one button once a production exists", () => {
    const markup = renderToStaticMarkup(<ZeropsNextStepStrip onReview={() => {}} strip={STRIP} />);
    expect(markup).not.toContain("Put it live");
  });
});
