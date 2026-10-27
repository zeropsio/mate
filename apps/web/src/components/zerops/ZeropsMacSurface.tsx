/** The panel's Mac view: the app an agent opened on the paired Mac (`ZeropsMacPanel`). */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { ZeropsMacPanel } from "./ZeropsMacPanel";

export function ZeropsMacSurface({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  if (threadRef === null) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-zerops-mac-surface>
      <div className="flex flex-col gap-6 p-4">
        <ZeropsMacPanel threadRef={threadRef} />
      </div>
    </div>
  );
}
