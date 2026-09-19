import { describe, expect, it } from "vite-plus/test";

import { changeVerdict } from "./changeVerdict.ts";
import type { GitCheckTone } from "./gitTab.ts";

const change = (over: { mergeable?: boolean; checks?: GitCheckTone } = {}) => ({
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
