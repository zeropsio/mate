/**
 * The conversation line's motion, as numbers (`ConversationStripMotion.tsx`).
 * Every edge a switch moves travels straight in the travel's eased progress:
 * a seat from where it was drawn to where it now stands, each end of the
 * band, the next seat's edge. So where a name's edge may be at any moment —
 * the lowest of its own opening or folding, the band arriving under it and
 * the seat after it making room — is straight between the moments two of
 * those cross, and is drawn exactly by keyframes at those moments: the
 * browser runs straight between keyframes in the same eased progress.
 */

/** A value moving with a travel: `from` as it sets off, `to` once it has arrived. */
export interface Track {
  readonly from: number;
  readonly to: number;
}

/** A keyframe: a point of the travel's eased progress, and the value there. */
export interface TrackFrame {
  readonly offset: number;
  readonly value: number;
}

const EPSILON = 1e-9;

const valueOf = (track: Track, progress: number) => track.from + (track.to - track.from) * progress;

/** Drops each keyframe that lies on the straight line between its neighbours. */
function straighten(frames: ReadonlyArray<TrackFrame>): ReadonlyArray<TrackFrame> {
  const kept: Array<TrackFrame> = [];
  for (const frame of frames) {
    while (kept.length >= 2) {
      const [before, last] = [kept[kept.length - 2]!, kept[kept.length - 1]!];
      const across =
        before.value +
        ((frame.value - before.value) * (last.offset - before.offset)) /
          (frame.offset - before.offset);
      if (Math.abs(across - last.value) > 1e-6) break;
      kept.pop();
    }
    kept.push(frame);
  }
  return kept;
}

/** Sorted, each once, within the travel. */
function moments(offsets: ReadonlyArray<number>): ReadonlyArray<number> {
  const sorted = [...offsets].filter((offset) => offset >= 0 && offset <= 1).sort((a, b) => a - b);
  return sorted.filter((offset, index) => index === 0 || offset - sorted[index - 1]! > EPSILON);
}

/**
 * The lowest of `tracks` at every moment of a travel, kept between `floor`
 * and `ceiling`, as keyframes at its ends and wherever that lowest turns.
 */
export function lowestTrack(
  tracks: ReadonlyArray<Track>,
  floor: number,
  ceiling: number,
): ReadonlyArray<TrackFrame> {
  const lines: ReadonlyArray<Track> = [
    ...tracks,
    { from: floor, to: floor },
    { from: ceiling, to: ceiling },
  ];
  const offsets = [0, 1];
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      const a = lines[first]!;
      const b = lines[second]!;
      const closing = a.to - a.from - (b.to - b.from);
      if (Math.abs(closing) < EPSILON) continue;
      const offset = (b.from - a.from) / closing;
      if (offset > EPSILON && offset < 1 - EPSILON) offsets.push(offset);
    }
  }
  const lowest = (progress: number) =>
    Math.min(
      ceiling,
      Math.max(floor, Math.min(...tracks.map((track) => valueOf(track, progress)))),
    );
  return straighten(moments(offsets).map((offset) => ({ offset, value: lowest(offset) })));
}

/**
 * How much of a name shows along its track: none with its edge at `floor` —
 * folded into its face — and all of it `span` past, straight in between.
 */
export function fadeAlong(
  frames: ReadonlyArray<TrackFrame>,
  floor: number,
  span: number,
): ReadonlyArray<TrackFrame> {
  const offsets = frames.map((frame) => frame.offset);
  for (let index = 1; index < frames.length; index += 1) {
    const left = frames[index - 1]!;
    const right = frames[index]!;
    for (const level of [floor, floor + span]) {
      const rise = right.value - left.value;
      if (Math.abs(rise) < EPSILON) continue;
      const part = (level - left.value) / rise;
      if (part > EPSILON && part < 1 - EPSILON) {
        offsets.push(left.offset + part * (right.offset - left.offset));
      }
    }
  }
  const at = (offset: number) => {
    const after = frames.findIndex((frame) => frame.offset >= offset - EPSILON);
    const right = frames[Math.max(0, after)]!;
    const left = frames[Math.max(0, after - 1)]!;
    const width = right.offset - left.offset;
    const value =
      width < EPSILON
        ? right.value
        : left.value + ((right.value - left.value) * (offset - left.offset)) / width;
    return Math.min(1, Math.max(0, (value - floor) / span));
  };
  return straighten(moments(offsets).map((offset) => ({ offset, value: at(offset) })));
}
