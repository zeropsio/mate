/**
 * The panel's Browser view: the Mate's sites to open, each as its own tab,
 * above the agent's own browser (`ZeropsBrowserPanel`). Opening Browser opens
 * this view alone — a site's tab exists only once a person picked it (the
 * owner, 2026-10-03: "the browser automatically opens all tabs, imo it
 * shouldnt and you should be able to open each separately").
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useMateAddresses } from "~/zerops/useMateAddresses";
import { MateAddressExternalLink, MateAddressLabel, openMateAddress } from "./MateAddresses";
import { MicroLabel } from "./primitives";
import { ZeropsBrowserPanel } from "./ZeropsBrowserPanel";

export function ZeropsBrowserSurface({
  threadRef,
}: {
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { addresses } = useMateAddresses(threadRef?.environmentId ?? null);
  if (threadRef === null) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-zerops-browser-surface>
      <div className="flex flex-col gap-6 p-4">
        {addresses.length === 0 ? null : (
          <section aria-label="Sites" className="flex flex-col gap-0.5">
            <MicroLabel className="px-1">Sites</MicroLabel>
            <ul className="flex flex-col">
              {addresses.map((address) => (
                <li
                  className="flex items-center gap-1 rounded-md pe-1 hover:bg-accent"
                  data-mate-address={address.service}
                  key={address.url}
                >
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-center px-1 py-1.5 text-left text-sm"
                    onAuxClick={(event) => openMateAddress(threadRef, address, event)}
                    onClick={(event) => openMateAddress(threadRef, address, event)}
                    type="button"
                  >
                    <MateAddressLabel address={address} showHost />
                  </button>
                  <MateAddressExternalLink address={address} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <ZeropsBrowserPanel threadRef={threadRef} />
      </div>
    </div>
  );
}
