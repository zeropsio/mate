/**
 * The panel's Browser view: the Mate's sites to open by environment, each as its own tab, filling
 * the panel. Opening Browser opens this view alone — a site's tab exists only once a person picked
 * it (the owner, 2026-10-03: "the browser automatically opens all tabs, imo it shouldnt and you
 * should be able to open each separately").
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useMateAddresses } from "~/zerops/useMateAddresses";
import { cn } from "~/lib/utils";
import type { MateAddress } from "~/zerops/mateAddresses.logic";
import { browserSiteGroups } from "./browserSites.logic";
import { MateAddressExternalLink, openMateAddress } from "./MateAddresses";
import { MicroLabel } from "./primitives";

/**
 * The Mate's sites by environment (`browserSiteGroups`), each row its service's name with the
 * address quiet beside it. A click opens the site in a tab of its own; the arrow, or a new-tab
 * gesture, in a new browser tab.
 */
export function BrowserSites({
  addresses,
  threadRef,
}: {
  readonly addresses: ReadonlyArray<MateAddress>;
  readonly threadRef: ScopedThreadRef;
}) {
  const groups = browserSiteGroups(addresses);
  if (groups.length === 0) return null;
  // One grid for every group, so the hosts stand in one column down the whole list.
  return (
    <div className="-mx-2 grid grid-cols-[max-content_minmax(0,1fr)_auto] gap-x-3">
      {groups.map((group, index) => (
        <section
          aria-label={group.title}
          className={cn("col-span-full grid grid-cols-subgrid", index > 0 && "mt-6")}
          data-browser-site-group={group.key}
          key={group.key}
        >
          <h3 className="col-span-full m-0 px-2 pb-1">
            <MicroLabel>{group.title}</MicroLabel>
          </h3>
          <ul className="col-span-full grid grid-cols-subgrid">
            {group.rows.map(({ address, name }) => (
              <li
                className="col-span-full grid grid-cols-subgrid items-center rounded-md hover:bg-accent"
                data-mate-address={address.service}
                key={address.url}
              >
                <button
                  className="col-span-2 grid cursor-pointer grid-cols-subgrid items-baseline py-1.5 ps-2 text-left"
                  onAuxClick={(event) => openMateAddress(threadRef, address, event)}
                  onClick={(event) => openMateAddress(threadRef, address, event)}
                  type="button"
                >
                  <span className="text-foreground text-sm">{name}</span>
                  <span className="truncate text-muted-foreground text-xs">{address.host}</span>
                </button>
                <MateAddressExternalLink address={address} className="me-1" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ZeropsBrowserSurface({
  threadRef,
}: {
  readonly threadRef: ScopedThreadRef | null;
}) {
  const { addresses } = useMateAddresses(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  if (threadRef === null) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-zerops-browser-surface>
      <div className="px-4 pt-4 pb-6">
        <BrowserSites addresses={addresses} threadRef={threadRef} />
      </div>
    </div>
  );
}
