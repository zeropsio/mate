/**
 * A place's vault at a glance, in its page's aside: what needs the person first, in the vault's own
 * sentences, then a row per part of it — its name as the vault names it, how many values it holds
 * and how many are hidden. Every row opens the page's vault drawer, a part's at that part. Names
 * and counts only: a value is never drawn here, and nothing is changed from here.
 */
import { ChevronRightIcon, KeyRoundIcon, RotateCwIcon } from "lucide-react";

import { Skeleton } from "~/components/ui/skeleton";
import type { VaultOverview } from "../vault/vaultOverview.logic";

const CARD = "flex min-w-0 flex-col rounded-xl border border-border/70 bg-card p-1.5";
/** A row that opens the drawer: it fills under the pointer and on focus, as the page's rows do. */
const ROW =
  "group flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-start outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring";
/** Where a row leads, at its end: every row of the card is a door, so it is said at rest. */
const GOES = "size-4 shrink-0 text-muted-foreground/70 group-hover:text-muted-foreground";
const QUIET = "px-3 py-2.5 text-body text-muted-foreground";
/** A part's row while the vault is read: its height, a name and its counts. */
const HELD = "flex h-10 items-center justify-between px-3";

/**
 * Props: `overview` (`vaultOverview(view)` of the vault the page's drawer reads); `onOpen` (opens
 * the drawer, at a part of the vault by its id where one is given).
 */
export function PlaceVaultCard({
  overview,
  onOpen,
}: {
  readonly overview: VaultOverview;
  readonly onOpen: (part?: string) => void;
}) {
  if (overview.state === "reading")
    return (
      // The settled shape while it is read: two parts, a name and its counts each.
      <div aria-busy="true" className={CARD} data-zerops-surface="place-vault" data-state="reading">
        <div aria-hidden="true" className={HELD}>
          <Skeleton className="h-3 w-24" surface="card" />
          <Skeleton className="h-3 w-28" surface="card" />
        </div>
        <div aria-hidden="true" className={HELD}>
          <Skeleton className="h-3 w-16" surface="card" />
          <Skeleton className="h-3 w-20" surface="card" />
        </div>
      </div>
    );
  if (overview.state === "unreadable")
    return (
      <div className={CARD} data-zerops-surface="place-vault" data-state="unreadable">
        <p className={QUIET}>Couldn&rsquo;t read the vault</p>
      </div>
    );
  return (
    <div className={CARD} data-zerops-surface="place-vault" data-state="read">
      {overview.needs.map((need) => (
        <button
          className={ROW}
          data-zerops-vault-need={need.kind}
          key={need.kind}
          onClick={() => {
            onOpen();
          }}
          type="button"
        >
          <span aria-hidden="true" className="flex shrink-0 text-status-attention-text">
            {need.kind === "not-live" ? (
              <RotateCwIcon className="size-3.5" />
            ) : (
              <KeyRoundIcon className="size-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-body text-status-attention-text">
            {need.text}
          </span>
          <ChevronRightIcon aria-hidden="true" className={GOES} />
        </button>
      ))}
      {overview.parts.length === 0 ? (
        <p className={QUIET}>Nothing in the vault yet</p>
      ) : (
        overview.parts.map((part) => (
          <button
            className={ROW}
            data-zerops-vault-part={part.id}
            key={part.id}
            onClick={() => {
              onOpen(part.id);
            }}
            type="button"
          >
            <span className="min-w-0 flex-1 truncate text-body text-foreground">{part.title}</span>
            <span className="shrink-0 text-caption whitespace-nowrap text-muted-foreground/80 tabular-nums">
              {part.counts}
            </span>
            <ChevronRightIcon aria-hidden="true" className={GOES} />
          </button>
        ))
      )}
    </div>
  );
}
