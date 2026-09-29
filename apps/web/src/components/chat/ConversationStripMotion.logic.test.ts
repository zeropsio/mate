import { describe, expect, it } from "vite-plus/test";

import { fadeAlong, lowestTrack, type TrackFrame } from "./ConversationStripMotion.logic";

/** The keyframes' value at `offset`, straight between them, as the browser draws it. */
function valueAt(frames: ReadonlyArray<TrackFrame>, offset: number): number {
  const after = frames.findIndex((frame) => frame.offset >= offset);
  if (after <= 0) return frames[0]!.value;
  const left = frames[after - 1]!;
  const right = frames[after]!;
  const span = right.offset - left.offset;
  return span === 0
    ? right.value
    : left.value + ((right.value - left.value) * (offset - left.offset)) / span;
}

const at = (track: { readonly from: number; readonly to: number }, progress: number) =>
  track.from + (track.to - track.from) * progress;

describe("lowestTrack", () => {
  it.each<{
    readonly name: string;
    readonly tracks: ReadonlyArray<{ readonly from: number; readonly to: number }>;
    readonly floor: number;
    readonly ceiling: number;
    readonly frames: ReadonlyArray<TrackFrame>;
  }>([
    {
      name: "one track within its bounds: straight from end to end",
      tracks: [{ from: 32, to: 115 }],
      floor: 32,
      ceiling: 115,
      frames: [
        { offset: 0, value: 32 },
        { offset: 1, value: 115 },
      ],
    },
    {
      name: "a name held at its face until the seat after it has made room",
      tracks: [
        { from: 32, to: 115 },
        { from: 6, to: 115 },
      ],
      floor: 32,
      ceiling: 115,
      frames: [
        { offset: 0, value: 32 },
        { offset: 26 / 109, value: 32 },
        { offset: 1, value: 115 },
      ],
    },
    {
      name: "a band arriving from the left: the name waits for it, then rides its edge",
      tracks: [
        { from: 32, to: 115 },
        { from: -191, to: 115 },
      ],
      floor: 32,
      ceiling: 115,
      frames: [
        { offset: 0, value: 32 },
        { offset: 223 / 306, value: 32 },
        { offset: 1, value: 115 },
      ],
    },
    {
      name: "a neighbour closing in faster than the fold: the fold follows it into the face",
      tracks: [
        { from: 115, to: 32 },
        { from: 115, to: 6 },
      ],
      floor: 32,
      ceiling: 115,
      frames: [
        { offset: 0, value: 115 },
        { offset: 83 / 109, value: 32 },
        { offset: 1, value: 32 },
      ],
    },
    {
      name: "tracks that cross: the lower of them at every moment",
      tracks: [
        { from: 0, to: 100 },
        { from: 50, to: 50 },
      ],
      floor: -1000,
      ceiling: 1000,
      frames: [
        { offset: 0, value: 0 },
        { offset: 0.5, value: 50 },
        { offset: 1, value: 50 },
      ],
    },
  ])("$name", ({ tracks, floor, ceiling, frames }) => {
    const result = lowestTrack(tracks, floor, ceiling);
    expect(result.map((frame) => frame.offset)).toEqual(
      frames.map((frame) => expect.closeTo(frame.offset, 9)),
    );
    expect(result.map((frame) => frame.value)).toEqual(
      frames.map((frame) => expect.closeTo(frame.value, 9)),
    );
  });

  it("is the clamped lowest track at every moment between its keyframes", () => {
    const tracks = [
      { from: 32, to: 140 },
      { from: -60, to: 140 },
      { from: 10, to: 140 },
    ];
    const frames = lowestTrack(tracks, 32, 140);
    for (let step = 0; step <= 200; step += 1) {
      const progress = step / 200;
      const lowest = Math.min(...tracks.map((track) => at(track, progress)));
      expect(valueAt(frames, progress)).toBeCloseTo(Math.min(140, Math.max(32, lowest)), 9);
    }
  });
});

describe("fadeAlong", () => {
  it("is clear at the floor and whole a span past it, straight in between", () => {
    const frames = lowestTrack([{ from: 32, to: 115 }], 32, 115);
    const fade = fadeAlong(frames, 32, 16);
    expect(fade).toEqual([
      { offset: 0, value: 0 },
      { offset: expect.closeTo(16 / 83, 9), value: expect.closeTo(1, 9) },
      { offset: 1, value: 1 },
    ]);
  });

  it("follows the track's opacity at every moment, a fold fading as it reaches the face", () => {
    const frames = lowestTrack(
      [
        { from: 115, to: 32 },
        { from: 115, to: 6 },
      ],
      32,
      115,
    );
    const fade = fadeAlong(frames, 32, 16);
    for (let step = 0; step <= 200; step += 1) {
      const progress = step / 200;
      const shown = (valueAt(frames, progress) - 32) / 16;
      expect(valueAt(fade, progress)).toBeCloseTo(Math.min(1, Math.max(0, shown)), 9);
    }
  });
});
