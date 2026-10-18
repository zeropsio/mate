/**
 * The panel's Browser view: the Mate's sites to open by environment, each as its own tab,
 * the pages it checked in its own test browser, and the browser it opens to
 * show you something (`ZeropsBrowserPanel`) — one quiet line until it has. Opening Browser opens
 * this view alone — a site's tab exists only once a person picked it (the
 * owner, 2026-10-03: "the browser automatically opens all tabs, imo it
 * shouldnt and you should be able to open each separately").
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsTimelineEntry } from "@t3tools/client-runtime/zerops/model";
import { useMemo } from "react";

import { useImageIntent } from "~/assets/MateImages";
import { useMateAddresses } from "~/zerops/useMateAddresses";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { TakeThumbnail, takeSource } from "../chat/BrowserStrip";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { checkedPages, type CheckedPage } from "./browserChecks.logic";
import { cn } from "~/lib/utils";
import type { MateAddress } from "~/zerops/mateAddresses.logic";
import { browserSiteGroups } from "./browserSites.logic";
import { MateAddressExternalLink, openMateAddress } from "./MateAddresses";
import { MicroLabel } from "./primitives";
import { ZeropsBrowserPanel } from "./ZeropsBrowserPanel";

/** A row's picture box, a desktop's shape: every row stands the same height. */
const THUMBNAIL_ASPECT = 1.6;

/**
 * The pages the Mate checked in its own test browser, newest first, each
 * opening its picture with the others beside it. That browser lives only for
 * each check and never reaches the live view below.
 */
function CheckedPages({
  pages,
  mateName,
  threadRef,
  onOpenImage,
}: {
  readonly pages: ReadonlyArray<CheckedPage>;
  readonly mateName: string | undefined;
  readonly threadRef: ScopedThreadRef;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
}) {
  const intent = useImageIntent();
  const title = `Pages ${mateName ?? "this Mate"} checked`;
  const images = pages.map((page) => ({
    src: takeSource(page.take.screenshot!.src, threadRef)!,
    name: `${page.page} on ${page.screen}`,
  }));
  return (
    <section aria-label={title} className="flex flex-col gap-1" data-zerops-checked-pages>
      <h3 className="m-0">
        <MicroLabel>{title}</MicroLabel>
      </h3>
      <ul className="-mx-2 flex flex-col">
        {pages.map((page, index) => {
          const when = formatRelativeTimeLabel(page.at);
          return (
            <li key={page.key}>
              <button
                {...intent}
                aria-label={`${page.page} on ${page.screen}${page.failed ? ", failed" : ""}. Open the picture`}
                className="flex w-full min-w-0 cursor-zoom-in items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                onClick={() => onOpenImage({ images, index })}
                type="button"
              >
                <span className="h-10 w-16 shrink-0 overflow-hidden rounded-sm border border-border bg-card">
                  <TakeThumbnail aspect={THUMBNAIL_ASPECT} src={images[index]!.src} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{page.page}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {[page.screen, when, page.failed ? "failed" : null]
                      .filter((part) => part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
  mateName,
  zeropsEntries,
  onOpenImage,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly mateName?: string | undefined;
  /** The conversation's Zerops model: where its browser checks are read from. */
  readonly zeropsEntries: ReadonlyArray<ZeropsTimelineEntry>;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
}) {
  const { addresses } = useMateAddresses(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  const pages = useMemo(() => checkedPages(zeropsEntries), [zeropsEntries]);
  if (threadRef === null) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-zerops-browser-surface>
      <div className="flex flex-col gap-6 px-4 pt-4 pb-6">
        <BrowserSites addresses={addresses} threadRef={threadRef} />
        {pages.length === 0 ? null : (
          <CheckedPages
            mateName={mateName}
            onOpenImage={onOpenImage}
            pages={pages}
            threadRef={threadRef}
          />
        )}
        <ZeropsBrowserPanel mateName={mateName} threadRef={threadRef} />
      </div>
    </div>
  );
}
