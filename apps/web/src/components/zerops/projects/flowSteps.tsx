/**
 * The pieces the projects list draws from: a Mate by face and name, a Mate being created, the
 * group's name, and which of a group's verbs stands where.
 */

import type {
  FlowPullRequest,
  GroupFlow,
  GroupFlowComing,
  GroupFlowMate,
} from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { mateBirthFace } from "~/zerops/agentActivity";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { MateFace } from "../primitives";
import { ZeropsMateCard } from "../ZeropsMateCard";
import { comingMateLine } from "./projectsView.logic";
import type { ProjectsFlowGroup } from "./ZeropsProjectsFlow";

export const QUIET_BUTTON_CLASS =
  "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent";

/** Whether a node would draw anything — a slot may answer `null` for "nothing here". */
export function drawn(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
}

const MATE_CHIP_CLASS =
  "-mx-1 inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-foreground";

/**
 * A Mate by name, with its face: the way into its conversation wherever a row
 * names it. A Mate that cannot open yet — coming up, busy — is the same face
 * and name with nothing to press; one still being created carries how far it
 * has got (`comingMateLine`) in its hover, a row having no room to say it.
 */
export function MateChip({
  face,
  name,
  onOpen,
  coming,
}: {
  readonly face: ReactNode;
  readonly name: string;
  readonly onOpen: (() => void) | undefined;
  readonly coming?: string | undefined;
}) {
  const body = (
    <>
      <span className="flex shrink-0">{face}</span>
      <span className="min-w-0 truncate">{name}</span>
    </>
  );
  if (coming !== undefined)
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span aria-busy="true" className={MATE_CHIP_CLASS} data-zerops-surface="mate-coming" />
          }
        >
          {body}
          <span className="sr-only">{coming}</span>
        </TooltipTrigger>
        <TooltipPopup>{coming}</TooltipPopup>
      </Tooltip>
    );
  if (onOpen === undefined) return <span className={MATE_CHIP_CLASS}>{body}</span>;
  return (
    <button
      aria-label={`Open ${name}`}
      className={cn(
        MATE_CHIP_CLASS,
        "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
      )}
      data-zerops-surface="mate-open"
      onClick={onOpen}
      type="button"
    >
      {body}
    </button>
  );
}

/**
 * A Mate being created wears the face its person picked in the New Mate
 * dialog — slate where it was given none — waking, as every Mate's is while it
 * comes up (`mateBirthFace`), asleep once its birth stopped: the face is where
 * that is read.
 */
export function ComingMateFace({
  size,
  coming,
}: {
  readonly size: "sm" | "md";
  readonly coming: GroupFlowComing;
}) {
  return (
    <MateFace
      shape={coming.face?.shape}
      size={size}
      state={mateBirthFace(coming.failed === true)}
      tint={coming.face?.tint ?? "slate"}
    />
  );
}

/**
 * A Mate being created, as a card or as a Projects row: the card a Mate on its
 * way up is, with its name and how far its birth has got — nothing to open,
 * nothing in its menu, until the listing holds it and its own card stands in
 * its place.
 */
export function ComingMateCard({
  name,
  coming,
  layout,
}: {
  readonly name: string;
  readonly coming: GroupFlowComing;
  readonly layout: "card" | "row";
}) {
  return (
    <ZeropsMateCard
      busy={coming.failed !== true}
      face={mateBirthFace(coming.failed === true)}
      layout={layout}
      shape={coming.face?.shape}
      line={
        <span className="min-w-0 truncate" data-zerops-surface="mate-coming">
          {comingMateLine(coming)}
        </span>
      }
      name={name}
      tint={coming.face?.tint ?? "slate"}
    />
  );
}

/**
 * *Release* beside a production that has something else to do first (D28):
 * the release that might clear a failed deploy stays in sight. Absent where
 * the next step already is the release, so the cell never shows it twice.
 */
export function releaseVerbFor<T>(
  entry: ProjectsFlowGroup<T>,
  renderReleaseVerb: ((entry: ProjectsFlowGroup<T>) => ReactNode) | undefined,
): ReactNode {
  const { production } = entry.flow;
  const offered =
    (production.kind === "ready-to-release" || production.kind === "deploy-failed") &&
    production.candidate !== undefined;
  if (!offered || entry.flow.nextStep.kind === "release") return null;
  return renderReleaseVerb?.(entry) ?? null;
}

/**
 * One of a group's Mates as a surface draws it: a listed one with its
 * environment, or one being created — no environment yet, only how far its
 * birth has got.
 */
export type FlowMateEntry<T> =
  | { readonly kind: "listed"; readonly item: T; readonly mate: GroupFlowMate }
  | { readonly kind: "coming"; readonly mate: GroupFlowMate; readonly coming: GroupFlowComing };

/**
 * A group's Mates in the flow's order — the listed ones, then the ones being
 * created — each listed one paired with its environment by project.
 */
export function matesOf<T>(entry: ProjectsFlowGroup<T>): ReadonlyArray<FlowMateEntry<T>> {
  return entry.flow.mates.flatMap((mate): ReadonlyArray<FlowMateEntry<T>> => {
    const item = entry.mates.get(mate.projectId);
    if (item !== undefined) return [{ kind: "listed", item, mate }];
    return mate.coming === undefined ? [] : [{ kind: "coming", mate, coming: mate.coming }];
  });
}

/**
 * Whether a pull request is the one the next step merges — its own row then
 * carries no second Merge beside the step's.
 */
export function mergesHere(flow: GroupFlow, pull: FlowPullRequest): boolean {
  const target = flow.nextStep.target;
  return (
    flow.nextStep.kind === "merge" &&
    target?.kind === "change" &&
    target.repository === pull.repository &&
    target.number === pull.number
  );
}

export function GroupName<T>({
  entry,
  className,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "min-w-0 truncate font-semibold tracking-tight text-foreground",
        entry.placeholder && "font-normal text-muted-foreground italic",
        className,
      )}
    >
      {entry.group.name}
    </span>
  );
}
