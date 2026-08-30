import { useEffect } from "react";
import { useReducedMotion, useSharedValue } from "react-native-reanimated";

const DEFAULT_DURATION = 1_100;
const DEFAULT_FRAME_COUNT = 3;

export function dutyCyclePresentation(props: {
  readonly active: boolean;
  readonly reducedMotion: boolean;
  readonly duration: number;
  readonly frameCount: number;
  readonly startValue: number;
  readonly endValue: number;
  readonly reducedMotionValue: number;
}) {
  if (!Number.isInteger(props.frameCount) || props.frameCount < 2 || props.frameCount > 8) {
    throw new Error("Duty cycles require 2 to 8 finite frames");
  }
  if (!Number.isFinite(props.duration) || props.duration < 1_000) {
    throw new Error("Duty cycles require a finite period of at least 1000 ms");
  }

  return {
    active: props.active && !props.reducedMotion,
    duration: props.duration,
    frameCount: props.frameCount,
    initialValue: props.reducedMotion ? props.reducedMotionValue : props.startValue,
    endValue: props.endValue,
  } as const;
}

export function startDutyCycleFrameDriver(
  options: {
    readonly duration: number;
    readonly frameCount: number;
    readonly startValue: number;
    readonly endValue: number;
  },
  onFrame: (value: number) => void,
) {
  const frames = Array.from(
    { length: options.frameCount },
    (_, index) =>
      options.startValue +
      (options.endValue - options.startValue) * (index / (options.frameCount - 1)),
  );
  let frameIndex = 0;
  onFrame(frames[frameIndex]);

  const interval = globalThis.setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length;
    onFrame(frames[frameIndex]);
  }, options.duration / options.frameCount);

  return () => globalThis.clearInterval(interval);
}

export function useDutyCycle(
  active: boolean,
  options: {
    readonly duration?: number;
    readonly frameCount?: number;
    readonly startValue?: number;
    readonly endValue?: number;
    readonly reducedMotionValue?: number;
  } = {},
) {
  const reducedMotion = useReducedMotion();
  const duration = options.duration ?? DEFAULT_DURATION;
  const frameCount = options.frameCount ?? DEFAULT_FRAME_COUNT;
  const startValue = options.startValue ?? 0;
  const endValue = options.endValue ?? 1;
  const reducedMotionValue = options.reducedMotionValue ?? startValue;
  const presentation = dutyCyclePresentation({
    active,
    reducedMotion,
    duration,
    frameCount,
    startValue,
    endValue,
    reducedMotionValue,
  });
  const progress = useSharedValue(presentation.initialValue);

  useEffect(() => {
    progress.value = presentation.initialValue;
    if (!presentation.active) return;

    return startDutyCycleFrameDriver(
      {
        duration: presentation.duration,
        frameCount: presentation.frameCount,
        startValue: presentation.initialValue,
        endValue: presentation.endValue,
      },
      (value) => {
        progress.value = value;
      },
    );
  }, [
    presentation.active,
    presentation.duration,
    presentation.endValue,
    presentation.frameCount,
    presentation.initialValue,
    progress,
  ]);

  return { progress, reducedMotion } as const;
}
