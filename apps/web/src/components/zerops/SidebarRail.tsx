/**
 * The closed menu on a desktop (`SidebarRail.logic.ts`): an 88 px rail of tiles. On top the Chief,
 * what waits on the viewer counted on its corner (the mark to the overview where the organization
 * holds no Chief), then search and the +; then one tile per project in the open menu's order — the
 * menu row's own face, or its group's cluster, over the project's name on one line — each with one
 * dot; at the foot the viewer's photo and the button that opens the menu again.
 *
 * A group's tile opens and folds its Mates' tiles under it, with the menu's own fold. A tile's card,
 * at once and instant from one tile to the next, names its project and Mate, says its state in
 * words and its last line. Resting on the rail never shows the open menu (the owner, 2026-10-12:
 * "unless we can keep the absolute same order and height of the avatar, it doesn't make sense, so
 * we should do tiles and just not do reveal").
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
import { PanelLeftOpenIcon } from "lucide-react";
import { useMemo, type ComponentProps, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { mateFaceOf, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { useMenuFolds } from "~/zerops/menuFolds";
import { useSidebarReveal } from "~/zerops/sidebarReveal";
import { useProjectMateActivity } from "~/zerops/useZeropsAgentActivity";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { useWaitsOnViewer } from "~/zerops/useZeropsMateOwners";

import { MateMark } from "../MateMark";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { MateDot } from "./MateDot";
import { MateOwnerMark } from "./MateOwnerMark";
import { MateFace } from "./primitives";
import { ownerBadge, ownerMark, type BadgeSeat } from "./SidebarMateRow.logic";
import { ProjectCluster } from "./SidebarProjectCluster";
import {
  railDot,
  railDotWords,
  railTilePress,
  railTiles,
  type RailDot,
  type RailTile,
  type RailTileMate,
} from "./SidebarRail.logic";
import { SidebarWaitingPopover, type WaitingVerbs } from "./SidebarWaiting";
import { waitingSummary, type WaitingItem } from "./SidebarWaiting.logic";

export interface RailMate extends RailTileMate {
  readonly name: string;
  /** Its project's name; empty for a Mate in no project. */
  readonly projectName: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  readonly face: MateMarkState;
  /** Its state was read, not remembered: only then does its face greet a change. */
  readonly known: boolean;
  /** A colleague's Mate: their mark on the face's corner, the face paler. */
  readonly badge: BadgeSeat | null;
  /** What its row's line says. */
  readonly line: string;
  /** What it waits on the viewer for, in the Waiting list's words. */
  readonly waits?: string | undefined;
}

/**
 * The rail's tiles: the Mates the menu shows, each as its row reads it, in the menu's order and
 * folded as the menu has them; and the menu's fold.
 */
export function useRailTiles<T extends ZeropsCandidate>(input: {
  readonly candidates: ReadonlyArray<T>;
  readonly activityOf: (candidate: T) => ZeropsAgentActivity | undefined;
  readonly shown: (candidate: T) => boolean;
  readonly ownerOf: (candidate: T) => ZeropsMateOwner | undefined;
  readonly projectName: (groupId: string) => string | undefined;
  readonly waiting: ReadonlyArray<WaitingItem>;
  readonly activeProjectId: string | null;
}): {
  readonly tiles: ReadonlyArray<RailTile<RailMate>>;
  readonly fold: ((groupId: string, open: boolean) => void) | null;
} {
  const { candidates, activityOf, shown, ownerOf, projectName, waiting, activeProjectId } = input;
  const order = useSidebarReveal((state) => state.mateOrder);
  const folds = useMenuFolds((state) => state.folds);
  const fold = useMenuFolds((state) => state.fold);
  const waitsOnViewer = useWaitsOnViewer();
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  const mates = useMemo(() => {
    const waits = new Map(
      waiting.flatMap((item) => (item.kind === "release" ? [] : [[item.mate.projectId, item]])),
    );
    return candidates.flatMap((candidate): ReadonlyArray<RailMate> => {
      if (!hasMate(candidate) || !shown(candidate)) return [];
      const id = candidate.project.id;
      const activity = activityOf(candidate);
      const waited = waits.get(id);
      const tint = tints.get(id) ?? "slate";
      const owner = ownerOf(candidate);
      const failed = activity?.remembered !== true && activity?.kind === "failed";
      const mine = waitsOnViewer(id);
      return [
        {
          projectId: id,
          groupId: readZeropsMembership(candidate.project).groupId ?? "",
          name: projectNameInApp(candidate.project),
          projectName: projectName(readZeropsMembership(candidate.project).groupId ?? "") ?? "",
          tint,
          shape: mateShapeOf(candidate.project, tint),
          face: mateFaceOf({
            connected: candidate.group === "connected",
            activity,
            reviewWaits: waited?.kind === "change",
            mine,
            pose: undefined,
          }),
          known: activity !== undefined && activity.remembered !== true,
          dot: railDot({
            waits: waited !== undefined && waited.kind !== "failed",
            failed,
            unread: activity?.unread === true,
            working: activity?.kind === "working",
          }),
          badge:
            owner === undefined || owner.isViewer
              ? null
              : ownerBadge({ kind: "person", mark: ownerMark(owner) }, false),
          mine: owner === undefined || owner.isViewer,
          asksViewer:
            mine &&
            (activity?.kind === "approval" ||
              activity?.kind === "input" ||
              activity?.kind === "planReady"),
          at: activity?.at,
          working: activity?.kind === "working",
          runSince: activity?.runSince,
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
  }, [activityOf, candidates, ownerOf, projectName, shown, tints, waiting, waitsOnViewer]);
  const tiles = useMemo(
    () => railTiles({ mates, order, folds, active: activeProjectId }),
    [activeProjectId, folds, mates, order],
  );
  return { tiles, fold };
}

/**
 * A Mate's card beside the rail: its name and project, its state in words, what was asked, its
 * last answer — read from the Mate's own activity while the card is open (the menu's list holds no
 * words of it).
 */
function RailMateTip({ mate }: { readonly mate: RailMate }) {
  const activity = useProjectMateActivity(mate.projectId);
  const asked = activity?.task ?? activity?.subject;
  const answer =
    mate.waits ??
    (activity?.kind === "failed" ? activity.errorLine : undefined) ??
    activity?.question ??
    activity?.snippet ??
    (mate.line.length > 0 ? mate.line : undefined);
  return (
    <span className="menu-rail-card" data-zerops-surface="sidebar-rail-card">
      <span className="menu-rail-card-name">
        {mate.projectName.length === 0 ? mate.name : mate.projectName}
        {mate.projectName.length === 0 ? null : (
          <span className="menu-rail-card-project">{mate.name}</span>
        )}
      </span>
      {mate.dot === undefined ? null : (
        <span className="menu-rail-card-state" data-dot={mate.dot}>
          {railDotWords(mate.dot)}
        </span>
      )}
      {asked === undefined ? null : <span className="menu-rail-card-asked">{asked}</span>}
      {answer === undefined ? null : <span className="menu-rail-card-answer">{answer}</span>}
    </span>
  );
}

/** A group's card: its project, then each Mate — its name, its state in words, its line. */
function RailGroupTip({
  name,
  mates,
}: {
  readonly name: string;
  readonly mates: ReadonlyArray<RailMate>;
}) {
  return (
    <span className="menu-rail-card" data-zerops-surface="sidebar-rail-card">
      <span className="menu-rail-card-name">
        {name}
        <span className="menu-rail-card-project">{`${String(mates.length)} Mates`}</span>
      </span>
      {mates.map((mate) => (
        <span className="menu-rail-card-mate" key={mate.projectId}>
          <span className="menu-rail-card-mate-name">
            {mate.name}
            {mate.dot === undefined ? null : (
              <span className="menu-rail-card-state" data-dot={mate.dot}>
                {railDotWords(mate.dot)}
              </span>
            )}
          </span>
          {mate.line.length === 0 ? null : <span className="menu-rail-card-line">{mate.line}</span>}
        </span>
      ))}
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

/** One dot on a face's corner: amber, red, blue, or the Mate's own tint at work. */
function RailDotMark({
  dot,
  tint,
}: {
  readonly dot: RailDot | undefined;
  readonly tint: MateTintId | undefined;
}) {
  if (dot === undefined) return null;
  return <MateDot place="corner" tint={tint} tone={dot} />;
}

/** A Mate's face as its menu row wears it: a colleague's paler, their mark on its corner. */
function RailFace({ mate, kid = false }: { readonly mate: RailMate; readonly kid?: boolean }) {
  return (
    <span className="menu-rail-face" data-kid={kid ? "" : undefined}>
      <span className={cn("relative flex", mate.badge !== null && "menu-face-cut menu-face-pale")}>
        <MateFace
          className={kid ? "size-7" : "size-9"}
          greets
          known={mate.known}
          shape={mate.shape}
          size={kid ? "md" : "lg"}
          state={mate.face}
          tint={mate.tint}
        />
      </span>
      {mate.badge === null ? null : <MateOwnerMark seat={mate.badge} />}
      <RailDotMark dot={mate.dot} tint={mate.tint} />
    </span>
  );
}

function RailControl({
  tip,
  children,
  ...button
}: {
  readonly tip: ReactNode;
  readonly children: ReactNode;
} & ComponentProps<"button">) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" {...button} />}>{children}</TooltipTrigger>
      <TooltipPopup side="right">{tip}</TooltipPopup>
    </Tooltip>
  );
}

const mateLabel = (mate: RailMate) =>
  `${mate.projectName.length > 0 ? `${mate.name}, ${mate.projectName}` : mate.name}${
    mate.dot === undefined ? "" : `, ${railDotWords(mate.dot)}`
  }`;

function RailTileView({
  tile,
  activeProjectId,
  onSelect,
  onFold,
}: {
  readonly tile: RailTile<RailMate>;
  readonly activeProjectId: string | null;
  readonly onSelect: (projectId: string) => void;
  readonly onFold: ((groupId: string, open: boolean) => void) | null;
}) {
  const press = () => {
    const step = railTilePress(tile);
    if (step.fold !== undefined) onFold?.(step.fold.groupId, step.fold.open);
    if (step.select !== undefined) onSelect(step.select);
  };
  if (tile.kind === "mate") {
    const { mate } = tile;
    const name = mate.projectName.length > 0 ? mate.projectName : mate.name;
    return (
      <div
        aria-current={tile.current ? "true" : undefined}
        aria-label={mate.projectName.length > 0 ? mate.projectName : undefined}
        className="menu-rail-project"
        data-zerops-surface="sidebar-rail-project"
        role="group"
      >
        <RailControl
          aria-current={tile.current ? "page" : undefined}
          aria-label={mateLabel(mate)}
          className="menu-rail-tile"
          data-current={tile.current ? "" : undefined}
          data-zerops-surface="sidebar-rail-mate"
          onClick={press}
          tip={<RailMateTip mate={mate} />}
        >
          <RailFace mate={mate} />
          <span
            aria-hidden="true"
            className="menu-rail-name"
            data-zerops-surface="sidebar-rail-name"
          >
            {name}
          </span>
        </RailControl>
      </div>
    );
  }
  const name = tile.mates[0]?.projectName ?? "";
  const working = tile.mates.find((mate) => mate.dot === "working");
  return (
    <div
      aria-current={tile.holdsCurrent ? "true" : undefined}
      aria-label={name}
      className="menu-rail-project"
      data-open={tile.open ? "" : undefined}
      data-zerops-surface="sidebar-rail-project"
      role="group"
    >
      <RailControl
        aria-current={tile.current ? "page" : undefined}
        aria-expanded={tile.open}
        aria-label={`${name}, ${String(tile.mates.length)} Mates${
          tile.dot === undefined ? "" : `, ${railDotWords(tile.dot)}`
        }`}
        className="menu-rail-tile"
        data-current={tile.current ? "" : undefined}
        data-zerops-surface="sidebar-rail-group"
        onClick={press}
        tip={<RailGroupTip mates={tile.mates} name={name} />}
      >
        <span className="menu-rail-face">
          <ProjectCluster
            faces={tile.faces.map((mate) => ({
              projectId: mate.projectId,
              name: mate.name,
              tint: mate.tint,
              shape: mate.shape,
              state: mate.face,
              known: mate.known,
              badge: mate.badge,
            }))}
            more={tile.more}
          />
          <RailDotMark dot={tile.dot} tint={working?.tint} />
        </span>
        <span aria-hidden="true" className="menu-rail-name" data-zerops-surface="sidebar-rail-name">
          {name}
        </span>
      </RailControl>
      {tile.open
        ? tile.mates.map((mate) => {
            const current = mate.projectId === activeProjectId;
            return (
              <RailControl
                aria-current={current ? "page" : undefined}
                aria-label={mateLabel(mate)}
                className="menu-rail-kid"
                data-current={current ? "" : undefined}
                data-zerops-surface="sidebar-rail-mate"
                key={mate.projectId}
                onClick={() => {
                  onSelect(mate.projectId);
                }}
                tip={<RailMateTip mate={mate} />}
              >
                <RailFace kid mate={mate} />
              </RailControl>
            );
          })
        : null}
    </div>
  );
}

export function SidebarRail({
  tiles,
  activeProjectId,
  chief,
  actions,
  overviewCurrent,
  headline,
  waiting,
  verbs,
  account,
  showMark,
  openShortcut,
  onOverview,
  onSelect,
  onFold,
  onOpenMenu,
}: {
  readonly tiles: ReadonlyArray<RailTile<RailMate>>;
  /** The Mate whose conversation is open. */
  readonly activeProjectId: string | null;
  /** The Chief's tile (`SidebarChiefTop`'s `tile`); none where the organization holds no Chief. */
  readonly chief?: ReactNode;
  /** Search and the +, as the open menu's top row holds them. */
  readonly actions?: ReactNode;
  readonly overviewCurrent: boolean;
  readonly headline: string;
  readonly waiting: ReadonlyArray<WaitingItem>;
  readonly verbs: WaitingVerbs;
  /** The viewer's photo, opening the account menu (`SidebarZeropsAccountRow`, collapsed). */
  readonly account: ReactNode;
  /** The top cell is the rail's; beside macOS's traffic lights that cell is theirs. */
  readonly showMark: boolean;
  readonly openShortcut: string | undefined;
  readonly onOverview: () => void;
  readonly onSelect: (projectId: string) => void;
  /** The menu's fold (`menuFolds.ts`); none while no menu is drawn under the rail. */
  readonly onFold: ((groupId: string, open: boolean) => void) | null;
  readonly onOpenMenu: () => void;
}) {
  const summary = waitingSummary(waiting);
  const head = chief ?? (
    // Without a Chief the mark leads to the overview, what waits on the viewer on its corner.
    <div className="menu-rail-chief">
      <RailControl
        aria-current={overviewCurrent ? "page" : undefined}
        aria-label="Overview"
        className="menu-rail-head"
        data-current={overviewCurrent ? "" : undefined}
        data-zerops-surface="sidebar-rail-overview"
        onClick={onOverview}
        tip={<RailTip line={headline} name="Overview" shortcut="⌥0" />}
      >
        <MateMark awake playful className="h-8.25 w-7" />
      </RailControl>
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
  );
  return (
    // Cards open at once, and instantly from one tile to the next while moving along the rail.
    <TooltipProvider closeDelay={0} delay={80} timeout={700}>
      <div className="menu-rail" data-zerops-surface="sidebar-rail">
        {showMark ? (
          <div className="menu-rail-top">{head}</div>
        ) : (
          <>
            <div className="menu-rail-top" />
            <div className="menu-rail-under-top">{head}</div>
          </>
        )}
        {actions === undefined ? null : <div className="menu-rail-actions">{actions}</div>}
        <div className="menu-rail-tiles">
          {tiles.map((tile) => (
            <RailTileView
              activeProjectId={activeProjectId}
              key={tile.key}
              onFold={onFold}
              onSelect={onSelect}
              tile={tile}
            />
          ))}
        </div>
        <div className="menu-rail-foot">
          {account}
          <RailControl
            aria-label="Open the menu"
            className="menu-rail-open"
            data-zerops-surface="sidebar-rail-open"
            onClick={onOpenMenu}
            tip={<RailTip name="Open the menu" shortcut={openShortcut} />}
          >
            <PanelLeftOpenIcon aria-hidden="true" className="size-4" />
          </RailControl>
        </div>
      </div>
    </TooltipProvider>
  );
}
