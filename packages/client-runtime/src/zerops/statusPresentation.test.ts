import { threadStatusVectors } from "@t3tools/shared/threadStatus.vectors";
import { describe, expect, it } from "vite-plus/test";

import { statusLabel, statusPulses } from "./statusPresentation.ts";

describe("thread status presentation", () => {
  it.each(threadStatusVectors)("presents $name", (vector) => {
    expect(statusLabel(vector.expected.kind)).toBe(vector.expectedLabel);
    expect(statusPulses(vector.expected.kind)).toBe(vector.expectedPulse);
  });
});
