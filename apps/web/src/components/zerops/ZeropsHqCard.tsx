/**
 * The organization's HQ at the projects page's end (SPEC §3.1, §4): its state and what it holds,
 * for everybody; for an owner or an admin, the day of the Core it runs, its last backup, what is
 * wrong with it, its update, and — opened — that Core whole and its services in Zerops
 * (`ZeropsHqCard.logic.ts`).
 *
 * Everything it shows comes from what the account observes — HQ's structure stream, which says
 * where HQ stands, the Core it runs and how its parts stand (`hqStandingAtom`), and HQ's services
 * as the organization's services listing holds them — and, while the card is open, HQ's project's
 * newest builds, its process history held as a detail of the account's store, as HQ's update reads
 * them. Where the stream names no Core, those name the running one (its `hq` service's active app
 * version), and the update is offered on it. What a refused read could not say, the card says.
 */
import { useAtomValue } from "@effect/atom-react";
import { NOT_READ_PROCESSES, projectProcessesAtom } from "@t3tools/client-runtime/data";
import { HQ_SERVICE, hqUpdateState } from "@t3tools/client-runtime/zerops/hq";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import { mayBearHq } from "@t3tools/shared/zeropsRoles";
import { Atom } from "effect/unstable/reactivity";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { hqMatesViewAtom, hqStandingAtom, hqStructureAtom } from "~/state/zerops";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useAccountHq, useCarriedCoreBuild } from "~/zerops/accountHq";
import { useDetailDemand, useProjectServices } from "~/zerops/ZeropsAccountData";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button } from "../ui/button";
import { FlatCard, MicroLabel, StatusDot } from "./primitives";
import { hqCardView, type HqCardUpdateRead, type HqCardView } from "./ZeropsHqCard.logic";
import { ZeropsHqUpdate } from "./ZeropsHqUpdate";
import { hqUpdateMount, type HqUpdateMount } from "./ZeropsHqUpdate.logic";

/**
 * How many of the Mates the viewer observes in `organizationId` are online, while HQ's view of them
 * is live: a number, so the card is not drawn again each time a Mate at work moves its overview.
 */
const hqOnlineMatesAtom = Atom.family((organizationId: string) =>
  Atom.make((get): number | undefined => {
    const view = get(hqMatesViewAtom);
    if (view?.organizationId !== organizationId || !view.current || view.mates === null) {
      return undefined;
    }
    let online = 0;
    for (const mate of view.mates.values()) if (mate.presence.online) online += 1;
    return online;
  }).pipe(Atom.withLabel(`zerops:hq-online-mates:${organizationId}`)),
);

const NO_PROCESSES = Atom.make(NOT_READ_PROCESSES);

/** HQ's project as the open card reads it. */
type HqProjectRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read" }
  | { readonly kind: "failed"; readonly reason: string };

export function ZeropsHqCard() {
  const { activeOrganization, user } = useZeropsSession();
  const organizationId = activeOrganization?.id;
  const accountHq = useAccountHq(organizationId);
  const hq = accountHq.hq.kind === "official" ? accountHq.hq : undefined;
  const standing = useAtomValue(hqStandingAtom);
  const carried = useCarriedCoreBuild();
  // Who looks after HQ — its Core, its backups, its updates — is who bears it (`mayBearHq`).
  const admin = user !== null && mayBearHq(activeOrganization ?? undefined);
  const structureView = useAtomValue(hqStructureAtom);
  const structure =
    structureView !== null && structureView.organizationId === organizationId
      ? structureView.structure
      : null;
  const online = useAtomValue(hqOnlineMatesAtom(organizationId ?? ""));
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  /** The person follows HQ's update: its dialog is open, or its update runs. */
  const [following, setFollowing] = useState(false);
  /** How the update control was last mounted: it stays so while followed through HQ's switch. */
  const [lastMount, setLastMount] = useState<HqUpdateMount | null>(null);
  const projectId = hq?.projectId ?? null;
  // HQ's project's newest builds are held while the card is open, and let go once it closes.
  useDetailDemand("process", "history", open ? projectId : null);
  const listed = useProjectServices(projectId);
  const activity = useAtomValue(
    projectId === null ? NO_PROCESSES : projectProcessesAtom(projectId),
  );
  const openCard = useCallback((next: boolean) => setOpen(next), []);
  const onBusy = useCallback((busy: boolean) => setUpdating(busy), []);

  /** HQ's project as the open card reads it: its services and its builds. */
  const project: HqProjectRead | undefined = !open
    ? undefined
    : listed.unavailableReason !== undefined || activity.history === "failed"
      ? { kind: "failed", reason: "Zerops refused to say." }
      : listed.services === undefined ||
          activity.history !== "read" ||
          activity.processes === undefined
        ? { kind: "reading" }
        : { kind: "read" };

  if (hq === undefined) return null;
  const services = project?.kind === "read" ? listed.services : undefined;
  const processes = project?.kind === "read" ? activity.processes : undefined;
  // HQ's builds say something only beside its `hq` service and the Core this app carries.
  const service = services?.find((entry) => entry.name === HQ_SERVICE);
  const update: HqCardUpdateRead | undefined =
    project === undefined || project.kind !== "read"
      ? project
      : service === undefined || carried === undefined || processes === undefined
        ? undefined
        : {
            kind: "read",
            // Weighed against the Core HQ answers with now: a new answer needs no new read.
            state: hqUpdateState({
              service,
              processes,
              carried,
              answering:
                standing.kind === "healthy" || standing.kind === "unchecked"
                  ? standing.build
                  : undefined,
            }),
          };
  const view = hqCardView({
    admin,
    standing,
    services,
    structure,
    online,
    update,
    updating,
    time: (ms) => formatDayAwareTimestamp(new Date(ms).toISOString(), timestampFormat),
  });
  const mount = hqUpdateMount({
    admin,
    standing,
    carried,
    zerops: update?.kind === "read" ? update.state : undefined,
    following,
    last: lastMount,
  });
  // Kept as it is mounted now, so a moment HQ does not answer finds it.
  if (
    mount !== null &&
    (lastMount === null ||
      mount.trigger !== lastMount.trigger ||
      mount.answering !== lastMount.answering ||
      mount.carried !== lastMount.carried)
  ) {
    setLastMount(mount);
  }
  return (
    <ZeropsHqCardView
      onOpenChange={openCard}
      open={open}
      projectUrl={zeropsProjectUrl(hq.projectId)}
      update={
        // Mounted while HQ answers, and through a moment it does not while the person follows
        // the update — its own switch to the new Core answers a health read 503 — so the dialog
        // sees the update to its end; the card recovers on its next read.
        mount === null ? null : (
          <ZeropsHqUpdate
            answering={mount.answering}
            carried={mount.carried}
            onBusy={onBusy}
            onFollowing={setFollowing}
            projectId={hq.projectId}
            trigger={mount.trigger}
          />
        )
      }
      view={view}
    />
  );
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
  update,
  projectUrl,
}: {
  readonly view: HqCardView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The update's offer and its dialog (`ZeropsHqUpdate`), an admin's. */
  readonly update: ReactNode;
  /** HQ's project in Zerops. */
  readonly projectUrl: string;
}) {
  return (
    <FlatCard
      className="px-3 py-2"
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
          <StatusDot label={view.state.word} sentence tone={view.state.tone} />
        )}
        {[view.coreDay, view.backup, view.counts].map((fact) =>
          fact === null ? null : (
            <span className="text-muted-foreground" key={fact}>
              {fact}
            </span>
          ),
        )}
        {update}
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
            <DetailRow label="Core">
              <span>{view.core}</span>
              {view.coreNote === null ? null : (
                <span className="text-muted-foreground">{view.coreNote}</span>
              )}
            </DetailRow>
          )}
          {view.services.length === 0 ? null : (
            <DetailRow label="Services">
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {view.services.map((service) => (
                  <StatusDot
                    key={service.name}
                    label={`${service.name} · ${service.word}`}
                    sentence
                    tone={service.tone}
                  />
                ))}
              </span>
            </DetailRow>
          )}
          <Button
            className="self-start"
            render={<a href={projectUrl} rel="noreferrer" target="_blank" />}
            size="xs"
            variant="link"
          >
            Open in Zerops
          </Button>
        </div>
      ) : null}
    </FlatCard>
  );
}
