import type { ZeropsTrendPoint } from "@t3tools/client-runtime/zerops/serviceMap";

import { sparklineGeometry } from "./sparkline";

/** A graph's box, in its own units; the stroke does not scale with it. */
const GRAPH_WIDTH = 48;
const GRAPH_HEIGHT = 14;

/** One resource's graph: what was used over the last day as a filled curve, the last hour marked. */
export function ResourceGraph({
  trend,
  id,
}: {
  trend: ReadonlyArray<ZeropsTrendPoint>;
  id: string;
}) {
  const geometry = sparklineGeometry(trend, GRAPH_WIDTH, GRAPH_HEIGHT, 1.5);
  const gradientId = `zerops-graph-${id}`;
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-12 shrink-0 self-end text-info"
      data-zerops-service-graph="live"
      preserveAspectRatio="none"
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {geometry.area === "" ? null : <path d={geometry.area} fill={`url(#${gradientId})`} />}
      {geometry.line === "" ? null : (
        <path
          d={geometry.line}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {geometry.end === undefined ? null : (
        <circle cx={geometry.end.x} cy={geometry.end.y} fill="currentColor" r="1.5" />
      )}
    </svg>
  );
}
