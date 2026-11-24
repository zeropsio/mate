import type { KitFlow } from "../kitFlows";

/**
 * A placeholder until the flow page lands: the flow's page framed at the canvas's width, one
 * frame per appearance.
 */
export function FlowPage({
  flow,
  appearance,
  viewport,
  zoom,
}: {
  flow: KitFlow;
  appearance: "light" | "dark" | "both";
  viewport: number;
  /** In percent: 100, 75 or 50. */
  zoom: number;
  state: string | undefined;
  onStateChange: (state: string | undefined) => void;
}) {
  const appearances = appearance === "both" ? (["light", "dark"] as const) : [appearance];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto bg-muted/40 p-4">
      {appearances.map((shown) => (
        // oxlint-disable-next-line react/iframe-missing-sandbox -- the flow is this build's own page
        <iframe
          className="mx-auto min-h-svh shrink-0 rounded-card border"
          key={`${flow.id}-${shown}`}
          src={`${flow.href}?theme=${shown}`}
          style={{ width: (viewport * zoom) / 100 }}
          title={`${flow.title}, ${shown}`}
        />
      ))}
    </div>
  );
}
