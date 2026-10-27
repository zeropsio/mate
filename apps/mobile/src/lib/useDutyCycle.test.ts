// @effect-diagnostics nodeBuiltinImport:off -- This test reads the helper source it constrains.
import * as NodeFS from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native-reanimated", () => ({
  useReducedMotion: vi.fn(() => false),
  useSharedValue: vi.fn((value: number) => ({ value })),
}));

import { dutyCyclePresentation, startDutyCycleFrameDriver } from "./useDutyCycle.ts";

describe("dutyCyclePresentation", () => {
  it.each([
    [true, false, true, 0],
    [false, false, false, 0],
    [true, true, false, 0.5],
    [false, true, false, 0.5],
  ] as const)(
    "plans active=%s reducedMotion=%s",
    (active, reducedMotion, expectedActive, expectedInitialValue) => {
      expect(
        dutyCyclePresentation({
          active,
          reducedMotion,
          duration: 1_100,
          frameCount: 3,
          startValue: 0,
          endValue: 1,
          reducedMotionValue: 0.5,
        }),
      ).toEqual({
        active: expectedActive,
        duration: 1_100,
        frameCount: 3,
        initialValue: expectedInitialValue,
        endValue: 1,
      });
    },
  );

  it.each([0, 1, 9, 2.5, Number.POSITIVE_INFINITY])(
    "rejects the unreviewed frame count %s",
    (frameCount) => {
      expect(() =>
        dutyCyclePresentation({
          active: true,
          reducedMotion: false,
          duration: 1_100,
          frameCount,
          startValue: 0,
          endValue: 1,
          reducedMotionValue: 0,
        }),
      ).toThrow("Duty cycles require 2 to 8 finite frames");
    },
  );

  it.each([0, 999, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the sub-second or non-finite period %s",
    (duration) => {
      expect(() =>
        dutyCyclePresentation({
          active: true,
          reducedMotion: false,
          duration,
          frameCount: 3,
          startValue: 0,
          endValue: 1,
          reducedMotionValue: 0,
        }),
      ).toThrow("Duty cycles require a finite period of at least 1000 ms");
    },
  );

  it.each([
    ["indeterminate LoadingStrip", 0.1, 0.9, [0.1, 0.5, 0.9, 0.1, 0.5, 0.9]],
    ["ConnectionStatusDot ripple", 0, 1, [0, 0.5, 1, 0, 0.5, 1]],
    ["StatusDot pulsing opacity", 0, 1, [0, 0.5, 1, 0, 0.5, 1]],
  ] as const)(
    "traces %s shared values over two periods",
    (_surface, startValue, endValue, expected) => {
      vi.useFakeTimers();
      const trace: number[] = [];
      const stop = startDutyCycleFrameDriver(
        { duration: 1_200, frameCount: 3, startValue, endValue },
        (value) => trace.push(value),
      );

      vi.advanceTimersByTime(2_399);
      stop();
      vi.advanceTimersByTime(1_200);

      expect(trace).toEqual(expected);
      vi.useRealTimers();
    },
  );

  it("uses a discrete frame-index driver and no infinite animation primitive", () => {
    const source = NodeFS.readFileSync(new URL("./useDutyCycle.ts", import.meta.url), "utf8");

    expect(source).toContain("setInterval");
    expect(source).not.toContain("withRepeat");
    expect(source).not.toContain("Infinity");
  });
});
