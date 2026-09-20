import { describe, expect, it } from "vite-plus/test";

import { changeVerdict } from "./changeVerdict.ts";
import { gitVerdict, type GitCheckoutState, type GitCheckTone } from "./gitTab.ts";

const change = (over: { mergeable?: boolean; checks?: GitCheckTone; merged?: boolean } = {}) => ({
  number: 4,
  mergeable: true,
  checks: "passing" as GitCheckTone,
  ...over,
});

describe("changeVerdict", () => {
  it("opens with the answer, not with a definition list", () => {
    const verdict = changeVerdict(change());
    expect(verdict.kind).toBe("ready");
    expect(verdict.tone).toBe("ok");
    expect(verdict.canMerge).toBe(true);
    expect(verdict.text).toBe("The checks passed. Nothing is stopping this change.");
    // Nothing to hand over: the remedy verb is not drawn at all.
    expect(verdict.ask).toBeUndefined();
  });

  it("draws no Merge on a change that has landed, and keeps it on one that could still land", () => {
    // Disabled is right where the verb is still ahead of the change — it says
    // what is in the way. A change that has landed has nothing ahead of it, so
    // the verb is not drawn at all.
    expect(changeVerdict(change({ merged: true })).offersMerge).toBe(false);
    const behind = changeVerdict(change({ mergeable: false }));
    expect(behind.canMerge).toBe(false);
    expect(behind.offersMerge).toBe(true);
    expect(changeVerdict(change()).offersMerge).toBe(true);
  });

  it("says a branch that has fallen behind cannot land, and hands it back", () => {
    const verdict = changeVerdict(change({ mergeable: false }));
    expect(verdict.kind).toBe("behind");
    expect(verdict.tone).toBe("attention");
    expect(verdict.canMerge).toBe(false);
    expect(verdict.text).toBe("This change no longer merges cleanly.");
    expect(verdict.ask).toContain("Rebase it on main");
  });

  it("separates checks that failed from checks that failed and blocked the merge", () => {
    // Gitea refuses it: the branch is protected and the checks are required.
    const blocked = changeVerdict(change({ mergeable: false, checks: "failing" }));
    expect(blocked.canMerge).toBe(false);
    expect(blocked.text).toBe("The checks failed, and this change cannot land until they pass.");
    // Gitea allows it: nothing required them. The page says so rather than
    // greying a button and leaving the reader to guess why it is not grey.
    const allowed = changeVerdict(change({ checks: "failing" }));
    expect(allowed.canMerge).toBe(true);
    expect(allowed.text).toBe("The checks failed.");
    // Either way the same words move it, so the same button appears.
    expect(allowed.ask).toBe(blocked.ask);
    expect(allowed.tone).toBe("failed");
  });

  it("asks for nothing while the checks are still running: waiting is the move", () => {
    for (const mergeable of [true, false]) {
      const verdict = changeVerdict(change({ mergeable, checks: "pending" }));
      expect(verdict.kind).toBe("checks-running");
      expect(verdict.tone).toBe("busy");
      expect(verdict.text).toBe("The checks are still running.");
      expect(verdict.ask).toBeUndefined();
    }
  });

  it("does not claim checks passed where none ran", () => {
    const verdict = changeVerdict(change({ checks: "none" }));
    expect(verdict.kind).toBe("unchecked");
    // No signal is not a good signal: grey, not green.
    expect(verdict.tone).toBe("off");
    expect(verdict.text).toBe("No checks ran here. Nothing is stopping this change.");
    expect(verdict.canMerge).toBe(true);
  });

  it("never offers a merge it knows the forge would refuse", () => {
    for (const checks of ["none", "pending", "passing", "failing"] as const) {
      expect(changeVerdict(change({ mergeable: false, checks })).canMerge).toBe(false);
      expect(changeVerdict(change({ mergeable: true, checks })).canMerge).toBe(true);
    }
  });
});

describe("the same change, wherever it is read", () => {
  const checkout: GitCheckoutState = {
    repository: "api",
    isRepo: true,
    hasRemote: true,
    headRef: "feature/invoices",
    aheadCount: 0,
    behindCount: 0,
    hasUpstream: true,
    changed: [],
  };

  /**
   * A pull request open from a Mate's branch is on two surfaces at once: its
   * own page, which opens with `changeVerdict`, and that Mate's Git tab, which
   * opens with `gitVerdict`. The words differ — the tab's line above already
   * carries the number and the branch — but a person who sees green on one and
   * blue on the other has been told two things about one fact. That is the
   * mistake a release's amber chip was (2026-09-19), caught here instead.
   */
  it.each([
    { mergeable: true, checks: "passing" },
    { mergeable: true, checks: "pending" },
    { mergeable: true, checks: "failing" },
    { mergeable: true, checks: "none" },
    { mergeable: false, checks: "passing" },
    { mergeable: false, checks: "pending" },
    { mergeable: false, checks: "failing" },
    { mergeable: false, checks: "none" },
  ] as const)("agrees on the colour of mergeable=$mergeable checks=$checks", (pull) => {
    expect(
      gitVerdict({
        state: "in-review",
        checks: pull.checks,
        checkout,
        pullRequestNumber: 4,
        mergeable: pull.mergeable,
        baseBranch: "main",
        trouble: "",
      })?.tone,
    ).toBe(changeVerdict({ number: 4, ...pull }).tone);
  });
});

describe("a change that has already landed", () => {
  it("says so, and offers no merge whatever the forge would take", () => {
    // Read from the forge by number rather than from the flow, which carries
    // only the open ones. *Merge* on it would be a lie twice over.
    expect(changeVerdict(change({ merged: true, mergeable: true, checks: "passing" }))).toEqual({
      kind: "merged",
      tone: "ok",
      text: "This change has landed.",
      ask: undefined,
      canMerge: false,
      offersMerge: false,
    });
  });

  it.each(["none", "pending", "passing", "failing"] as const)(
    "does not reopen the question of %s checks",
    (checks) => {
      const verdict = changeVerdict(change({ merged: true, mergeable: false, checks }));
      expect(verdict.kind).toBe("merged");
      expect(verdict.canMerge).toBe(false);
      expect(verdict.ask).toBeUndefined();
    },
  );

  it("reads an absent flag as not landed, which is what every open change is", () => {
    expect(changeVerdict(change({ checks: "passing" })).kind).toBe("ready");
  });
});
