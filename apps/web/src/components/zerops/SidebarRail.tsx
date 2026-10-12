/**
 * The closed menu on a desktop (`SidebarRail.logic.ts`): a 64 px rail. The mark leads to the
 * overview; Overview wears the selected band while it is open, and what waits on the viewer as a
 * count on its corner, which opens the same Waiting on you list beside the rail — one control, as
 * the open menu's Overview row (the owner, 2026-10-12: "why is this still split into waiting for
 * you?"); each Mate's face opens its conversation, a colleague's with
 * its owner's photo on its corner and a dot when it waits, failed or has a result not yet seen;
 * the viewer's photo opens the account menu, and the last button opens the menu again.
 *
 * A closed menu still says what is what (the owner, 2026-10-11: "absolutely shit for navigation,
 * you have absolutely no idea what is what, the tooltip is slow and small"): each project's name
 * heads its faces — the project is how a Mate is found (2026-10-12) — and a face's tooltip, at
 * once and instant from one face to the next, is a card of its name, its project, what was asked
 * and its last answer. A Mate in no project carries its own name under its face.
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
import { useMemo, type ReactNode } from "react";

import { APP_BASE_NAME } from "~/branding";
import { mateFaceOf, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { useProjectMateActivity } from "~/zerops/useZeropsAgentActivity";
import { useSidebarReveal } from "~/zerops/sidebarReveal";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { useWaitsOnViewer } from "~/zerops/useZeropsMateOwners";

import { MateMark } from "../MateMark";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
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
  /** What its row's second line says. */
  readonly line: string;
  /** What it waits on the viewer for, in the Waiting list's words. */
  readonly waits?: string | undefined;
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
          waits: waited?.mate.text,
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

/**
 * A face's card beside the rail: its name and project, what was asked, its last answer — read from
 * the Mate's own activity while the card is open (the menu's list holds no words of it).
 */
function RailMateTip({
  projectId,
  name,
  projectName,
  waits,
  line,
}: {
  readonly projectId: string;
  readonly name: string;
  readonly projectName: string;
  /** What it waits on the viewer for, in the Waiting list's words. */
  readonly waits: string | undefined;
  /** What its row says, where its own activity holds no words yet. */
  readonly line: string;
}) {
  const activity = useProjectMateActivity(projectId);
  const asked = activity?.task ?? activity?.subject;
  const answer =
    waits ??
    (activity?.kind === "failed" ? activity.errorLine : undefined) ??
    activity?.question ??
    activity?.snippet ??
    (line.length > 0 ? line : undefined);
  return (
    <span className="menu-rail-card" data-zerops-surface="sidebar-rail-card">
      <span className="menu-rail-card-name">
        {name}
        {projectName.length === 0 ? null : (
          <span className="menu-rail-card-project">{` · ${projectName}`}</span>
        )}
      </span>
      {asked === undefined ? null : <span className="menu-rail-card-asked">{asked}</span>}
      {answer === undefined ? null : <span className="menu-rail-card-answer">{answer}</span>}
    </span>
  );
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
  mate = false,
  named = false,
}: {
  readonly label: string;
  readonly tip: ReactNode;
  readonly current?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly surface: string;
  /** A Mate's face. */
  readonly mate?: boolean;
  /** Its own name under it: a Mate in no project, which its project cannot name. */
  readonly named?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-current={current ? "page" : undefined}
            aria-label={label}
            className={mate ? "menu-rail-button menu-rail-mate" : "menu-rail-button"}
            data-named={mate && named ? "" : undefined}
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
    // Tooltips open at once, and instantly from one control to the next while moving along the rail.
    <TooltipProvider closeDelay={0} delay={80} timeout={700}>
      <div className="menu-rail" data-zerops-surface="sidebar-rail">
        <div className="menu-rail-top">
          {showMark ? (
            <Link aria-label={APP_BASE_NAME} className="menu-rail-mark" to="/zerops">
              <MateMark awake playful className="h-8.25 w-7" />
            </Link>
          ) : null}
        </div>
        <div className="menu-rail-overview">
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
        <i aria-hidden="true" className="menu-rail-sep" />
        <div className="menu-rail-faces">
          {groups.map((group, index) => {
            // The project leads: a Mate is found by where it works, its name and face its own
            // (the owner, 2026-10-12: "you absolutely do not identify your mate by the name,
            // shape or color, it's the project what is the main identifier").
            const project = group[0]?.projectName ?? "";
            return (
              <div
                aria-label={project.length > 0 ? project : undefined}
                className="menu-rail-project"
                data-zerops-surface="sidebar-rail-project"
                key={group[0]?.groupId ?? index}
                role="group"
              >
                {project.length === 0 ? null : (
                  <span aria-hidden="true" className="menu-rail-project-name">
                    {project}
                  </span>
                )}
                {group.map((mate) => (
                  <RailButton
                    current={mate.projectId === activeProjectId}
                    key={mate.projectId}
                    mate
                    named={project.length === 0}
                    label={
                      mate.projectName.length > 0 ? `${mate.name}, ${mate.projectName}` : mate.name
                    }
                    onClick={() => {
                      onSelect(mate.projectId);
                    }}
                    surface="sidebar-rail-mate"
                    tip={
                      <RailMateTip
                        line={mate.line}
                        name={mate.name}
                        projectId={mate.projectId}
                        projectName={mate.projectName}
                        waits={mate.waits}
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
                        <Avatar
                          initials={mate.owner.initials}
                          size="xs"
                          src={mate.owner.avatarUrl}
                        />
                      </span>
                    )}
                    {mate.dot === undefined ? null : (
                      <i aria-hidden="true" className="menu-rail-dot" data-dot={mate.dot} />
                    )}
                    {project.length > 0 ? null : (
                      <span aria-hidden="true" className="menu-rail-name">
                        {mate.name}
                      </span>
                    )}
                  </RailButton>
                ))}
              </div>
            );
          })}
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
    </TooltipProvider>
  );
}
