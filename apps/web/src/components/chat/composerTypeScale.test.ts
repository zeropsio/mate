import { describe, expect, it } from "vite-plus/test";

import nextStepStrip from "../zerops/ZeropsNextStepBanner.tsx?raw";
import control from "./ComposerControl.tsx?raw";
import modelControl from "./ComposerModelControl.tsx?raw";
import approvalPanel from "./ComposerPendingApprovalPanel.tsx?raw";
import questionPanel from "./ComposerPendingUserInputPanel.tsx?raw";
import stashBadge from "./ComposerStashBadge.tsx?raw";
import stashMenu from "./ComposerStashMenu.tsx?raw";
import tasksBadge from "./ComposerTasksBadge.tsx?raw";
import contextWindowMeter from "./ContextWindowMeter.tsx?raw";

// One type scale in the composer's chrome (S1): 14 for what anyone wrote,
// 13 for secondary lines, times and code, 12 for small labels — counts and
// keys. 11, 10, 9 and 7 px go.
const BELOW_THE_SCALE = /\btext-(?:2xs|3xs)\b|\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/;

describe("the composer's chrome keeps to 14 / 13 / 12", () => {
  it.each([
    { file: "ComposerControl.tsx", source: control },
    { file: "ComposerModelControl.tsx", source: modelControl },
    { file: "ZeropsNextStepBanner.tsx", source: nextStepStrip },
    { file: "ComposerPendingApprovalPanel.tsx", source: approvalPanel },
    { file: "ComposerPendingUserInputPanel.tsx", source: questionPanel },
    { file: "ComposerStashBadge.tsx", source: stashBadge },
    { file: "ComposerStashMenu.tsx", source: stashMenu },
    { file: "ComposerTasksBadge.tsx", source: tasksBadge },
    { file: "ContextWindowMeter.tsx", source: contextWindowMeter },
  ])("$file", ({ source }) => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).not.toMatch(BELOW_THE_SCALE);
  });
});
