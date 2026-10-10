/**
 * The closed menu on a desktop (`SidebarRail.logic.ts`): a 64 px rail. The mark leads to the
 * overview; the waiting count opens the same Waiting on you list beside the rail; Overview wears
 * the selected band while it is open; each Mate's face opens its conversation, a colleague's with
 * its owner's photo on its corner and a dot when it waits, failed or has a result not yet seen;
 * the viewer's photo opens the account menu, and the last button opens the menu again. Tooltips
 * say a face's name · project and its line.
 */
import {
  assignCandidateMateTints,
  hasMate,
  mateShapeOf,
  projectNameInApp,
  readZeropsMembership,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { Link } from "@tanstack/react-router";
import { LayersIcon, PanelLeftOpenIcon } from "lucide-react";
import { Fragment, useMemo, type ReactNode } from "react";

import { APP_BASE_NAME } from "~/branding";
import { mateFaceOf, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { useSidebarReveal } from "~/zerops/sidebarReveal";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { useWaitsOnViewer } from "~/zerops/useZeropsMateOwners";

import { MateMark } from "../MateMark";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Avatar, MateFace } from "./primitives";
import { railDot, railGroups, type RailDot } from "./SidebarRail.logic";
import { SidebarWaitingPopover, type WaitingVerbs } from "./SidebarWaiting";
import { waitingSummary, type WaitingItem } from "./SidebarWaiting.logic";

export interface RailMate {
  readonly projectId: string;
  readonly groupId: string;
  readonly name: string;
  readonly projectName: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  readonly face: MateMarkState;
  readonly dot: RailDot | undefined;
  /** A colleague's Mate: its owner's photo on the face's corner. */
  readonly owner: ZeropsMateOwner | undefined;
  /** What its row's second line says, for the tooltip. */
  readonly line: string;
}

/** The rail's faces: the Mates the menu shows, each as its row reads it. */
export function useRailMates<T extends ZeropsCandidate>(input: {
  readonly candidates: ReadonlyArray<T>;
  readonly activityOf: (candidate: T) => ZeropsAgentActivity | undefined;
  readonly shown: (candidate: T) => boolean;
  readonly ownerOf: (candidate: T) => ZeropsMateOwner | undefined;
  readonly projectName: (groupId: string) => string | undefined;
  readonly waiting: ReadonlyArray<WaitingItem>;
}): ReadonlyArray<ReadonlyArray<RailMate>> {
  const { candidates, activityOf, shown, ownerOf, projectName, waiting } = input;
  const order = useSidebarReveal((state) => state.mateOrder);
  const waitsOnViewer = useWaitsOnViewer();
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  return useMemo(() => {
    const waits = new Map(
      waiting.flatMap((item) => (item.kind === "release" ? [] : [[item.mate.projectId, item]])),
    );
    const mates = candidates.flatMap((candidate): ReadonlyArray<RailMate> => {
      if (!hasMate(candidate) || !shown(candidate)) return [];
      const id = candidate.project.id;
      const activity = activityOf(candidate);
      const waited = waits.get(id);
      const tint = tints.get(id) ?? "slate";
      const groupId = readZeropsMembership(candidate.project).groupId ?? "";
      const owner = ownerOf(candidate);
      const failed = activity?.remembered !== true && activity?.kind === "failed";
      return [
        {
          projectId: id,
          groupId,
          name: projectNameInApp(candidate.project),
          projectName: projectName(groupId) ?? "",
          tint,
          shape: mateShapeOf(candidate.project, tint),
          face: mateFaceOf({
            connected: candidate.group === "connected",
            activity,
            reviewWaits: waited?.kind === "change",
            mine: waitsOnViewer(id),
            pose: undefined,
          }),
          dot: railDot({
            waits: waited !== undefined && waited.kind !== "failed",
            failed,
            unread: activity?.unread === true,
          }),
          owner: owner === undefined || owner.isViewer ? undefined : owner,
          line:
            waited?.mate.text ??
            (failed ? activity?.errorLine : undefined) ??
            activity?.snippet ??
            activity?.subject ??
            "",
        },
      ];
    });
    return railGroups(mates, order);
  }, [activityOf, candidates, order, ownerOf, projectName, shown, tints, waiting, waitsOnViewer]);
}

/** A tooltip beside the rail: what the control is, its key, and its line. */
function RailTip({
  name,
  shortcut,
  line,
}: {
  readonly name: string;
  readonly shortcut?: string | undefined;
  readonly line?: string | undefined;
}) {
  return (
    <span className="menu-rail-tip">
      <span className="menu-rail-tip-name">
        {name}
        {shortcut === undefined ? null : <span className="menu-rail-tip-key">{shortcut}</span>}
      </span>
      {line === undefined || line.length === 0 ? null : (
        <span className="menu-rail-tip-line">{line}</span>
      )}
    </span>
  );
}

function RailButton({
  label,
  tip,
  current = false,
  onClick,
  children,
  surface,
}: {
  readonly label: string;
  readonly tip: ReactNode;
  readonly current?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly surface: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-current={current ? "page" : undefined}
            aria-label={label}
            className="menu-rail-button"
            data-current={current ? "" : undefined}
            data-zerops-surface={surface}
            onClick={onClick}
            type="button"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="right">{tip}</TooltipPopup>
    </Tooltip>
  );
}

export function SidebarRail({
  groups,
  activeProjectId,
  overviewCurrent,
  headline,
  waiting,
  verbs,
  account,
  showMark,
  openShortcut,
  onOverview,
  onSelect,
  onOpenMenu,
}: {
  readonly groups: ReadonlyArray<ReadonlyArray<RailMate>>;
  /** The Mate whose conversation is open: its face wears the selected band. */
  readonly activeProjectId: string | null;
  readonly overviewCurrent: boolean;
  readonly headline: string;
  readonly waiting: ReadonlyArray<WaitingItem>;
  readonly verbs: WaitingVerbs;
  /** The viewer's photo, opening the account menu (`SidebarZeropsAccountRow`, collapsed). */
  readonly account: ReactNode;
  /** The mark stands in the top cell; beside macOS's traffic lights that cell is theirs. */
  readonly showMark: boolean;
  readonly openShortcut: string | undefined;
  readonly onOverview: () => void;
  readonly onSelect: (projectId: string) => void;
  readonly onOpenMenu: () => void;
}) {
  const summary = waitingSummary(waiting);
  return (
    <div className="menu-rail" data-zerops-surface="sidebar-rail">
      <div className="menu-rail-top">
        {showMark ? (
          <Link aria-label={APP_BASE_NAME} className="menu-rail-mark" to="/zerops">
            <MateMark awake playful className="h-8.25 w-7" />
          </Link>
        ) : null}
      </div>
      <div className="menu-rail-slot">
        {waiting.length === 0 ? null : (
          <SidebarWaitingPopover
            items={waiting}
            tooltip={
              <RailTip
                line={`${summary.words}${summary.more > 0 ? ` · ${String(summary.more)} more` : ""}`}
                name="Waiting on you"
                shortcut="⌥↓"
              />
            }
            trigger={
              <button
                aria-label={`${String(waiting.length)} waiting on you`}
                className="menu-rail-count"
                data-waiting-trigger=""
                data-zerops-surface="sidebar-rail-waiting"
                type="button"
              />
            }
            verbs={verbs}
          >
            {waiting.length}
          </SidebarWaitingPopover>
        )}
      </div>
      <RailButton
        current={overviewCurrent}
        label="Overview"
        onClick={onOverview}
        surface="sidebar-rail-overview"
        tip={<RailTip line={headline} name="Overview" shortcut="⌥0" />}
      >
        <span className="menu-rail-disc" aria-hidden="true">
          <LayersIcon className="size-4.5" />
        </span>
      </RailButton>
      <i aria-hidden="true" className="menu-rail-sep" />
      <div className="menu-rail-faces">
        {groups.map((group, index) => (
          <Fragment key={group[0]?.groupId ?? index}>
            {index === 0 ? null : <i aria-hidden="true" className="menu-rail-sep" />}
            {group.map((mate) => (
              <RailButton
                current={mate.projectId === activeProjectId}
                key={mate.projectId}
                label={
                  mate.projectName.length > 0 ? `${mate.name}, ${mate.projectName}` : mate.name
                }
                onClick={() => {
                  onSelect(mate.projectId);
                }}
                surface="sidebar-rail-mate"
                tip={
                  <RailTip
                    line={mate.line}
                    name={
                      mate.projectName.length > 0 ? `${mate.name} · ${mate.projectName}` : mate.name
                    }
                  />
                }
              >
                <MateFace
                  className="size-9"
                  shape={mate.shape}
                  size="md"
                  state={mate.face}
                  tint={mate.tint}
                />
                {mate.owner === undefined ? null : (
                  <span className="menu-rail-owner" aria-hidden="true">
                    <Avatar initials={mate.owner.initials} size="xs" src={mate.owner.avatarUrl} />
                  </span>
                )}
                {mate.dot === undefined ? null : (
                  <i aria-hidden="true" className="menu-rail-dot" data-dot={mate.dot} />
                )}
              </RailButton>
            ))}
          </Fragment>
        ))}
      </div>
      <span className="menu-rail-spring" />
      <div className="menu-rail-foot">
        {account}
        <RailButton
          label="Open the menu"
          onClick={onOpenMenu}
          surface="sidebar-rail-open"
          tip={<RailTip name="Open the menu" shortcut={openShortcut} />}
        >
          <PanelLeftOpenIcon aria-hidden="true" className="size-4" />
        </RailButton>
      </div>
    </div>
  );
}
