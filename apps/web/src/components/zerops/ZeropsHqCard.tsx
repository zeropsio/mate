/**
 * The organization's HQ at the projects page's end (SPEC §3.1, §4): its state and what it holds,
 * for everybody; for an owner or an admin, the day of the Core it runs, its last backup, what is
 * wrong with it, and — opened — that Core whole (`ZeropsHqCard.logic.ts`).
 *
 * Everything it shows comes from what the account observes — HQ's structure stream, which says
 * where HQ stands, the Core it runs and how its parts stand (`hqStandingAtom`). The HQ every
 * organization shares lives in no project of theirs: its card shows only what HQ reports.
 */
import { useAtomValue } from "@effect/atom-react";
import { mayBearHq } from "@t3tools/shared/zeropsRoles";
import { Atom } from "effect/reactivity";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { hqMatesAtom, hqStandingAtom, hqNavigationAtom } from "~/state/zerops";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { MicroLabel, STATUS_BADGE_TONE } from "./primitives";
import { hqCardView, hqNavigationTrouble, type HqCardView } from "./ZeropsHqCard.logic";
import { Badge } from "~/components/ui/badge";

/**
 * How many of the Mates the viewer observes in `organizationId` are online, while HQ's view of them
 * is live: a number, so the card is not drawn again each time a Mate at work moves its overview.
 */
const hqOnlineMatesAtom = Atom.family((organizationId: string) =>
  Atom.make((get): number | undefined => {
    const view = get(hqMatesAtom);
    if (view?.organizationId !== organizationId || !view.current || view.mates === null) {
      return undefined;
    }
    let online = 0;
    for (const mate of view.mates.values()) if (mate.presence.online) online += 1;
    return online;
  }).pipe(Atom.withLabel(`zerops:hq-online-mates:${organizationId}`)),
);

export function ZeropsHqCard() {
  const { activeOrganization, user } = useZeropsSession();
  const organizationId = activeOrganization?.id;
  const standing = useAtomValue(hqStandingAtom);
  // Who looks after HQ — its Core, its backups — is who bears it (`mayBearHq`).
  const admin = user !== null && mayBearHq(activeOrganization ?? undefined);
  const navigation = useAtomValue(hqNavigationAtom);
  const structure = navigation.orgId === organizationId ? navigation.structure : null;
  const online = useAtomValue(hqOnlineMatesAtom(organizationId ?? ""));
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [open, setOpen] = useState(false);
  const openCard = useCallback((next: boolean) => setOpen(next), []);

  const resolvedView = hqCardView({
    admin,
    standing,
    structure,
    online,
    time: (ms) => formatDayAwareTimestamp(new Date(ms).toISOString(), timestampFormat),
  });
  const trouble = hqNavigationTrouble(navigation);
  const view: HqCardView =
    resolvedView.state !== null || navigation.read === "read" || trouble === null
      ? resolvedView
      : { ...resolvedView, troubles: [...resolvedView.troubles, trouble] };
  return <ZeropsHqCardView onOpenChange={openCard} open={open} view={view} />;
}

/** One of the opened card's rows: its `MicroLabel`, then what it says. */
function DetailRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <MicroLabel className="w-16 shrink-0 text-muted-foreground">{label}</MicroLabel>
      <span className="flex min-w-0 flex-col gap-0.5">{children}</span>
    </div>
  );
}

export function ZeropsHqCardView({
  view,
  open,
  onOpenChange,
}: {
  readonly view: HqCardView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    // One quiet line at the overview's end, no card around it (round 5).
    <div
      className="py-2"
      data-hq-state={view.state?.kind ?? "unknown"}
      data-zerops-surface="hq-card"
    >
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {view.opens ? (
          <button
            aria-expanded={open}
            className="-ms-1 inline-flex items-center gap-1 rounded-md px-1 font-medium"
            onClick={() => onOpenChange(!open)}
            type="button"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 text-muted-foreground transition-transform duration-200 ease-out",
                open && "rotate-90",
              )}
            />
            HQ
          </button>
        ) : (
          <span className="font-medium">HQ</span>
        )}
        {view.state === null ? null : (
          <Badge dot tone={STATUS_BADGE_TONE[view.state.tone]}>
            {view.state.word}
          </Badge>
        )}
        {[view.coreDay, view.backup, view.counts].map((fact) =>
          fact === null ? null : (
            <span className="text-muted-foreground" key={fact}>
              {fact}
            </span>
          ),
        )}
      </div>
      {view.troubles.length === 0 ? null : (
        <ul className="flex flex-col gap-0.5 pb-1 text-xs text-status-attention-text" role="status">
          {view.troubles.map((trouble) => (
            <li data-hq-trouble key={trouble}>
              {trouble}
            </li>
          ))}
        </ul>
      )}
      {open && view.opens ? (
        <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2 pb-1 text-xs">
          {view.core === null ? null : (
            <DetailRow label="Version">
              <span>{view.core}</span>
            </DetailRow>
          )}
        </div>
      ) : null}
    </div>
  );
}
