import { WaitLine } from "./zerops/WaitLine";

/**
 * Keep the requested surface's space while its code is being loaded: its line centred in whatever
 * space it stands in — filling a sized box, stretched across a flex row, grown down a column.
 */
export function SurfaceLoading() {
  return (
    <div
      className="flex h-full min-h-32 flex-1 items-center justify-center self-stretch"
      role="status"
    >
      <WaitLine text="Loading…" />
    </div>
  );
}
