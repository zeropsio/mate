import { describe, expect, it } from "vite-plus/test";

import { changeReviewReadout, HEAD_NOT_SENT } from "./changeReviewReadout.logic";
import type { ReadoutPart } from "./useZeropsChangeDetail";

const READ: ReadoutPart<string> = { kind: "read", value: "its files" };
const FAILED: ReadoutPart<string> = { kind: "failed", reason: "No answer came in time." };
const NO_HEAD: ReadoutPart<string> = { kind: "none" };

// Lukas, 2026-10-28: a change drawn from the menu's row has no head until the application's detail
// says it, and nothing reads it meanwhile: the review waited for good, and Merge with it.
describe("changeReviewReadout: a review never waits for good on what it shows", () => {
  it.each<[string, Parameters<typeof changeReviewReadout<string>>[0], ReadoutPart<string>]>([
    [
      "a change whose head HQ said reads as its own read does",
      { detail: READ, appFailure: undefined, outwaited: true },
      READ,
    ],
    [
      "a change whose head HQ said fails as its own read does",
      { detail: FAILED, appFailure: "HQ refused this.", outwaited: false },
      FAILED,
    ],
    [
      "a change whose head HQ has not said yet is read while the review waits",
      { detail: NO_HEAD, appFailure: undefined, outwaited: false },
      { kind: "reading" },
    ],
    [
      "a change whose application HQ cannot read says HQ's reason at once",
      { detail: NO_HEAD, appFailure: "HQ refused this.", outwaited: false },
      { kind: "failed", reason: "HQ refused this." },
    ],
    [
      "a change whose head HQ never said says so once the review stops waiting",
      { detail: NO_HEAD, appFailure: undefined, outwaited: true },
      { kind: "failed", reason: HEAD_NOT_SENT },
    ],
  ])("%s", (_case, input, shown) => {
    expect(changeReviewReadout(input)).toEqual(shown);
  });
});
