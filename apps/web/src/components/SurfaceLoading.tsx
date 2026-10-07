import { WaitLine } from "./zerops/WaitLine";

/** Keep the requested surface's space while its code is being loaded. */
export function SurfaceLoading() {
  return (
    <div className="flex h-full min-h-32 flex-1 items-center justify-center" role="status">
      <WaitLine text="Loading…" />
    </div>
  );
}
