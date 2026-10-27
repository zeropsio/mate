/**
 * The service card's graphs, as geometry: the Zerops dashboard's usage
 * graph reduced to a sparkline — what was used, hour by hour, drawn for its
 * shape. Pure — points in, SVG path strings out — so the curve is tested as
 * numbers, not pixels.
 */
import type { ZeropsTrendPoint } from "@t3tools/client-runtime/zerops/serviceMap";

export interface SparklinePoint {
  readonly x: number;
  readonly y: number;
}

export interface SparklineGeometry {
  /** The used series as a monotone curve. */
  readonly line: string;
  /** The same curve closed to the baseline, for the fade fill. */
  readonly area: string;
  /** The last point of the used series, for the end marker. */
  readonly end: SparklinePoint | undefined;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * A monotone cubic (Fritsch–Carlson) through the points, as an SVG path: the
 * curve never overshoots a sample, so a flat hour stays flat and a step reads
 * as a step. Two points draw a straight segment; one point, a dot's worth.
 */
export function monotonePath(points: ReadonlyArray<SparklinePoint>): string {
  if (points.length === 0) return "";
  const [first] = points;
  if (points.length === 1 || first === undefined) {
    return first === undefined ? "" : `M${round(first.x)},${round(first.y)}`;
  }
  const n = points.length;
  const dx: Array<number> = [];
  const dy: Array<number> = [];
  const slope: Array<number> = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    dx.push(b.x - a.x);
    dy.push(b.y - a.y);
    slope.push(dx[i] === 0 ? 0 : dy[i]! / dx[i]!);
  }
  const tangent: Array<number> = [slope[0]!];
  for (let i = 1; i < n - 1; i += 1) {
    const left = slope[i - 1]!;
    const right = slope[i]!;
    tangent.push(left * right <= 0 ? 0 : (left + right) / 2);
  }
  tangent.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i += 1) {
    const m = slope[i]!;
    if (m === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const alpha = tangent[i]! / m;
    const beta = tangent[i + 1]! / m;
    const bound = alpha * alpha + beta * beta;
    if (bound > 9) {
      const scale = 3 / Math.sqrt(bound);
      tangent[i] = scale * alpha * m;
      tangent[i + 1] = scale * beta * m;
    }
  }
  let path = `M${round(first.x)},${round(first.y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const third = dx[i]! / 3;
    path += ` C${round(a.x + third)},${round(a.y + tangent[i]! * third)} ${round(b.x - third)},${round(b.y - tangent[i + 1]! * third)} ${round(b.x)},${round(b.y)}`;
  }
  return path;
}

/**
 * Lays a trend out in a `width × height` box. The y scale is the most that
 * was used in the window — the graph is for the shape of use, the figure
 * above it already says the allocation — so a steady service draws a
 * level line and a busy hour a hill; a window with nothing used draws along
 * the baseline. `inset` keeps the stroke inside the box.
 */
export function sparklineGeometry(
  trend: ReadonlyArray<ZeropsTrendPoint>,
  width: number,
  height: number,
  inset = 1,
): SparklineGeometry {
  if (trend.length === 0) {
    return { line: "", area: "", end: undefined };
  }
  const top = Math.max(...trend.map((point) => point.used));
  const usable = height - inset * 2;
  const stepX = trend.length === 1 ? 0 : (width - inset * 2) / (trend.length - 1);
  const y = (value: number): number =>
    top <= 0 ? height - inset : inset + usable - (value / top) * usable;
  const used = trend.map((point, index) => ({ x: inset + index * stepX, y: y(point.used) }));
  const line = monotonePath(used);
  const last = used.at(-1);
  const area =
    last === undefined
      ? ""
      : `${line} L${round(last.x)},${round(height - inset)} L${round(inset)},${round(height - inset)} Z`;
  return { line, area, end: last };
}
