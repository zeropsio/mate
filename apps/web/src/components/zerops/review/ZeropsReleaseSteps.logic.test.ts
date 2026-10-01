import { describe, expect, it } from "vite-plus/test";

import {
  RELEASE_STEP_START,
  releaseStep,
  type ReleaseStep,
  type ReleaseStepEvent,
} from "./ZeropsReleaseSteps.logic";

const GUESTBOOK = { repository: "appdev", number: 2 } as const;
const COPY = { repository: "appdev", number: 3 } as const;

const ON_CHANGE: ReleaseStep = {
  view: "change",
  change: GUESTBOOK,
  rowKey: "aaa111",
  releaseScroll: 140,
};

const BACK_ON_RELEASE: ReleaseStep = { view: "release", scrollTop: 140, returnTo: "aaa111" };

describe("releaseStep: the release dialog steps into a change and back", () => {
  it.each<[string, ReleaseStep, ReleaseStepEvent, ReleaseStep, boolean]>([
    [
      "a change row pressed steps into its review, keeping where the release was scrolled",
      RELEASE_STEP_START,
      { kind: "open", change: GUESTBOOK, rowKey: "aaa111", releaseScroll: 140 },
      ON_CHANGE,
      false,
    ],
    [
      "back returns to the release, scrolled where it was, its row to take the focus",
      ON_CHANGE,
      { kind: "back" },
      BACK_ON_RELEASE,
      false,
    ],
    ["the first Esc goes back one step", ON_CHANGE, { kind: "escape" }, BACK_ON_RELEASE, false],
    [
      "Esc on the release closes the dialog",
      BACK_ON_RELEASE,
      { kind: "escape" },
      BACK_ON_RELEASE,
      true,
    ],
    [
      "Esc on a release never stepped into closes it too",
      RELEASE_STEP_START,
      { kind: "escape" },
      RELEASE_STEP_START,
      true,
    ],
    [
      "back on the release does nothing",
      RELEASE_STEP_START,
      { kind: "back" },
      RELEASE_STEP_START,
      false,
    ],
    [
      "another row pressed while a change shows opens that one, the release's scroll kept",
      ON_CHANGE,
      { kind: "open", change: COPY, rowKey: "bbb222", releaseScroll: 0 },
      { view: "change", change: COPY, rowKey: "bbb222", releaseScroll: 140 },
      false,
    ],
  ])("%s", (_case, state, event, next, closes) => {
    expect(releaseStep(state, event)).toEqual({ state: next, closes });
  });

  it("two Escs from a change close the dialog: back, then close", () => {
    const first = releaseStep(ON_CHANGE, { kind: "escape" });
    const second = releaseStep(first.state, { kind: "escape" });
    expect([first.closes, second.closes]).toEqual([false, true]);
  });
});
