/**
 * A place's vault at a glance, in its page's aside: what needs the person first, in the vault's own
 * sentences, then a row per part of it — its name as the vault names it, how many values it holds
 * and how many are hidden; the shared vault first, a hairline, then each app's own, as the drawer
 * groups them. Every row opens the page's vault drawer, a part's at that part. Names and counts
 * only: a value is never drawn here, and nothing is changed from here.
 */
import { ChevronRightIcon, KeyRoundIcon, RotateCwIcon } from "lucide-react";

import { Card } from "~/components/ui/card";
import { Row } from "~/components/ui/row";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import type { VaultOverview, VaultOverviewPart } from "../vault/vaultOverview.logic";
import { VaultPartName } from "../vault/VaultPartName";
import { EmptyState } from "~/components/ui/empty";

/** A row that opens the drawer: it fills under the pointer and on focus, as the page's rows do. */
/** Where a row leads, at its end: every row of the card is a door, so it is said at rest. */
const GOES = "size-4 shrink-0 text-muted-foreground/70";
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
      <Card
        aria-busy="true"
        className="min-w-0"
        data-state="reading"
        data-zerops-surface="place-vault"
        size="rows"
      >
        <div aria-hidden="true" className={HELD}>
          <Skeleton className="h-3 w-24" surface="card" />
          <Skeleton className="h-3 w-28" surface="card" />
        </div>
        <div aria-hidden="true" className={HELD}>
          <Skeleton className="h-3 w-16" surface="card" />
          <Skeleton className="h-3 w-20" surface="card" />
        </div>
      </Card>
    );
  if (overview.state === "unreadable")
    return (
      <Card
        className="min-w-0"
        data-state="unreadable"
        data-zerops-surface="place-vault"
        size="rows"
      >
        <p className={QUIET}>Couldn&rsquo;t read the vault</p>
      </Card>
    );
  const forAll = overview.parts.filter((part) => part.hostname === null);
  const own = overview.parts.filter((part) => part.hostname !== null);
  const rowOf = (part: VaultOverviewPart) => (
    <Row
      data-zerops-vault-part={part.id}
      key={part.id}
      meta={
        <span className="flex items-center gap-2">
          {part.counts}
          <ChevronRightIcon aria-hidden="true" className={GOES} />
        </span>
      }
      pressable
      render={
        <button
          onClick={() => {
            onOpen(part.id);
          }}
          type="button"
        />
      }
      size="sm"
      title={<VaultPartName scope={part} size="row" />}
    />
  );
  return (
    <Card className="min-w-0" data-state="read" data-zerops-surface="place-vault" size="rows">
      {overview.needs.map((need) => (
        <Row
          data-zerops-vault-need={need.kind}
          key={need.kind}
          lead={
            <span aria-hidden="true" className="flex text-status-attention-text">
              {need.kind === "not-live" ? (
                <RotateCwIcon className="size-3.5" />
              ) : (
                <KeyRoundIcon className="size-3.5" />
              )}
            </span>
          }
          meta={<ChevronRightIcon aria-hidden="true" className={GOES} />}
          pressable
          render={
            <button
              onClick={() => {
                onOpen();
              }}
              type="button"
            />
          }
          size="sm"
          title={<span className="font-normal text-status-attention-text">{need.text}</span>}
        />
      ))}
      {overview.parts.length === 0 ? (
        <EmptyState size="row">Nothing in the vault yet.</EmptyState>
      ) : (
        <>
          {forAll.map(rowOf)}
          {forAll.length === 0 || own.length === 0 ? null : (
            <div aria-hidden="true" className="px-3 py-1.5" data-zerops-vault-rule="">
              <Separator />
            </div>
          )}
          {own.map(rowOf)}
        </>
      )}
    </Card>
  );
}
