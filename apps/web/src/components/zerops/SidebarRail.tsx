/**
 * The closed menu on a desktop (`SidebarRail.logic.ts`): a 76 px rail of tiles, to the owner's
 * design (pen.dev, "Collapsed sidebar"). On top the open menu's squares in two rows — Overview,
 * what waits on the viewer counted on its corner, and the +; search and whose Mates — then the
 * Chief's tile and one tile per project in the open menu's order — the menu row's own face, or its
 * group's cluster, over the project's name on one line — each with one dot; at the foot the
 * viewer's photo and the button that opens the menu again.
 *
 * A group's tile opens and folds its Mates' tiles under it, with the menu's own fold. A tile's card,
 * at once and instant from one tile to the next, names its project and Mate, says its state in
 * words and its last line. Resting on the rail never shows the open menu (the owner, 2026-10-12:
 * "unless we can keep the absolute same order and height of the avatar, it doesn't make sense, so
 * we should do tiles and just not do reveal").
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqPersonFactsAtom } from "@t3tools/client-runtime/data";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { Atom } from "effect/reactivity";
import {
  assignCandidateMateTints,
  selectMateEnvironments,
  type ZeropsGroupPendingMember,
  mateShapeOf,
  projectNameInApp,
  readZeropsMembership,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { MateComing } from "@t3tools/client-runtime/data";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { asksPerson } from "@t3tools/shared/threadStatus";
import { LayoutGridIcon, PanelRightCloseIcon } from "lucide-react";
import { useMemo, type ComponentProps, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  answerAwaitedWords,
  mateBirthFace,
  type ZeropsAgentActivity,
} from "~/zerops/agentActivity";
import { useMenuFolds } from "~/zerops/menuFolds";
import { useSidebarReveal } from "~/zerops/sidebarReveal";
import { useProjectMateActivity } from "~/zerops/useZeropsAgentActivity";
import type { ZeropsMateOwner } from "~/zerops/useZeropsMateOwners";
import { useWaitsOnViewer } from "~/zerops/useZeropsMateOwners";

import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { MateDot } from "./MateDot";
import { MateOwnerMark } from "./MateOwnerMark";
import { RailTip } from "./SidebarRailTip";
import { FACE_CUT, FACE_CUT_KID, FACE_PALE } from "./menuFace";
import { MateFace } from "./primitives";
import {
  mateAutomation,
  comingWaitsOnMaker,
  mateComingRowView,
  WAITS_ON_MAKER_LINE,
  mateRowReading,
  ownerBadge,
  ownerMark,
  type BadgeSeat,
} from "./SidebarMateRow.logic";
import { ProjectCluster } from "./SidebarProjectCluster";
import {
  comingDot,
  railDotWords,
  railMateDot,
  railTilePress,
  railTiles,
  type RailComing,
  type RailDot,
  type RailTile,
  type RailTileMate,
} from "./SidebarRail.logic";
import { SidebarWaitingCount, type WaitingVerbs } from "./SidebarWaiting";
import type { WaitingItem } from "~/zerops/waiting.logic";
import { Button } from "../ui/button";
import { Text } from "~/components/ui/text";

export const menuPersonFactsAtom = Atom.make((get) =>
  Object.fromEntries(
    Object.entries(get(shownHqPersonFactsAtom)).map(([id, fact]) => [id, { mine: fact.mine }]),
  ),
).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a));
export const menuComingMatesAtom = Atom.make<
  Readonly<Record<string, ReadonlyArray<ZeropsGroupPendingMember>>>
>({}).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a));

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
  /** Whether it is still coming up, or its setup stopped, as its menu row reads it (`useMateComingOf`). */
  readonly comingOf: (candidate: T) => MateComing | undefined;
  /** A coming Mate's birth row by its birth, as the menu's coming row reads it (`getBirth`). */
  readonly birthOf: (
    birthId: string,
  ) => { readonly attention: boolean; readonly waitsOnMaker?: boolean } | undefined;
  readonly shown: (candidate: T) => boolean;
  readonly ownerOf: (candidate: T) => ZeropsMateOwner | undefined;
  readonly projectName: (groupId: string) => string | undefined;
  readonly waiting: ReadonlyArray<WaitingItem>;
  readonly activeProjectId: string | null;
}): {
  readonly tiles: ReadonlyArray<RailTile<RailMate>>;
  readonly fold: ((groupId: string, open: boolean) => void) | null;
} {
  const {
    candidates,
    activityOf,
    comingOf,
    birthOf,
    shown,
    ownerOf,
    projectName,
    waiting,
    activeProjectId,
  } = input;
  const comingByGroup = useAtomValue(menuComingMatesAtom);
  const personFacts = useAtomValue(menuPersonFactsAtom);
  const order = useSidebarReveal((state) => state.mateOrder);
  const folds = useMenuFolds((state) => state.folds);
  const fold = useMenuFolds((state) => state.fold);
  const waitsOnViewer = useWaitsOnViewer();
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  const mates = useMemo(() => {
    const waits = new Map(
      waiting.flatMap((item) => (item.kind === "release" ? [] : [[item.mate.projectId, item]])),
    );
    return selectMateEnvironments(candidates).flatMap((candidate): ReadonlyArray<RailMate> => {
      if (!shown(candidate)) return [];
      const id = candidate.project.id;
      const activity = activityOf(candidate);
      const waited = waits.get(id);
      const tint = tints.get(id) ?? "slate";
      const owner = ownerOf(candidate);
      const failed = activity?.remembered !== true && activity?.kind === "failed";
      const mine = waitsOnViewer(id);
      const name = projectNameInApp(candidate.project);
      // Its row's reading, as the menu's row reads it: its face, and the dot it wears.
      const read = mateRowReading({
        name,
        connected: candidate.group === "connected",
        activity,
        reviewWaits: waited?.kind === "change",
        mine,
        free: mateAutomation(candidate.project.hq?.mate)?.task === null,
      });
      const coming = comingOf(candidate);
      const view = coming === undefined ? read : mateComingRowView(read, coming);
      const held =
        waited?.mate.text ?? (comingWaitsOnMaker(coming) ? WAITS_ON_MAKER_LINE.words : undefined);
      return [
        {
          projectId: id,
          groupId: readZeropsMembership(candidate.project).groupId ?? "",
          name,
          projectName: projectName(readZeropsMembership(candidate.project).groupId ?? "") ?? "",
          tint,
          shape: mateShapeOf(candidate.project, tint),
          face: read.face,
          known: activity !== undefined && activity.remembered !== true,
          dot: railMateDot(view, activity?.kind === "working"),
          badge:
            owner === undefined || owner.isViewer
              ? null
              : ownerBadge({ kind: "person", mark: ownerMark(owner) }, false),
          owner,
          asksViewer: mine && activity !== undefined && asksPerson(activity.kind),
          at: activity?.at,
          working: activity?.kind === "working",
          runSince: activity?.runSince,
          waits: held,
          line:
            held ??
            (failed ? activity?.errorLine : undefined) ??
            answerAwaitedWords(activity) ??
            activity?.snippet ??
            activity?.subject ??
            "",
        },
      ];
    });
  }, [
    activityOf,
    candidates,
    comingOf,
    ownerOf,
    projectName,
    shown,
    tints,
    waiting,
    waitsOnViewer,
  ]);
  const tiles = useMemo(
    () =>
      railTiles({
        mates,
        personFacts,
        comingByGroup,
        birthOf,
        projectName,
        order,
        folds,
        active: activeProjectId,
      }),
    [activeProjectId, birthOf, comingByGroup, folds, mates, order, personFacts, projectName],
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
    answerAwaitedWords(activity) ??
    activity?.snippet ??
    (mate.line.length > 0 ? mate.line : undefined);
  return (
    <span className="grid max-w-80 gap-1 px-0.5 py-1" data-zerops-surface="sidebar-rail-card">
      <span className="flex min-w-0 items-baseline gap-1.5 text-body font-semibold">
        {mate.projectName.length === 0 ? mate.name : mate.projectName}
        {mate.projectName.length === 0 ? null : (
          <span className="truncate text-body font-normal text-muted-foreground">{mate.name}</span>
        )}
      </span>
      {mate.dot === undefined ? null : (
        <span
          className="text-caption font-medium data-[dot=attention]:text-status-attention-text data-[dot=failed]:text-status-failed-text data-[dot=unread]:text-info-foreground data-[dot=working]:text-muted-foreground"
          data-dot={mate.dot}
        >
          {railDotWords(mate.dot)}
        </span>
      )}
      {asked === undefined ? null : (
        <span className="line-clamp-2 text-body leading-4.5">{asked}</span>
      )}
      {answer === undefined ? null : (
        <span className="line-clamp-2 text-body leading-4.5 text-muted-foreground">{answer}</span>
      )}
    </span>
  );
}

/** A group's card: its project, then each Mate — its name, its state in words, its line. */
function RailGroupTip({
  name,
  mates,
  coming,
}: {
  readonly coming: ReadonlyArray<RailComing>;
  readonly name: string;
  readonly mates: ReadonlyArray<RailMate>;
}) {
  return (
    <span className="grid max-w-80 gap-1 px-0.5 py-1" data-zerops-surface="sidebar-rail-card">
      <span className="flex min-w-0 items-baseline gap-1.5 text-body font-semibold">
        {name}
        <span className="truncate text-body font-normal text-muted-foreground">{`${String(mates.length + coming.length)} Mates`}</span>
      </span>
      {mates.map((mate) => (
        <span className="grid min-w-0 pt-1" key={mate.projectId}>
          <span className="flex items-baseline gap-2 text-body leading-4.5 font-medium">
            {mate.name}
            {mate.dot === undefined ? null : (
              <span
                className="text-caption font-medium data-[dot=attention]:text-status-attention-text data-[dot=failed]:text-status-failed-text data-[dot=unread]:text-info-foreground data-[dot=working]:text-muted-foreground"
                data-dot={mate.dot}
              >
                {railDotWords(mate.dot)}
              </span>
            )}
          </span>
          {mate.line.length === 0 ? null : (
            <Text truncate variant="note">
              {mate.line}
            </Text>
          )}
        </span>
      ))}
      {coming.map(({ member }) => (
        <span className="grid min-w-0 pt-1" key={member.projectId}>
          {member.name}
        </span>
      ))}
    </span>
  );
}

/** One dot on a face's corner: amber, red, blue, or the Mate's own tint at work. */
function RailDotMark({
  dot,
  tint,
  kid = false,
}: {
  readonly dot: RailDot | undefined;
  readonly tint: MateTintId | undefined;
  /** Under its open group, on a kid's face: still, the face already moves while it works. */
  readonly kid?: boolean;
}) {
  if (dot === undefined) return null;
  return (
    <MateDot
      className={kid ? "top-0.5 end-0.5" : undefined}
      place="corner"
      tint={tint}
      tone={dot}
    />
  );
}

/** A Mate's face as its menu row wears it: a colleague's paler, their mark on its corner. */
function RailFace({ mate, kid = false }: { readonly mate: RailMate; readonly kid?: boolean }) {
  return (
    <span className="relative grid size-9 place-items-center">
      <span
        className={cn(
          "relative flex",
          mate.badge !== null && (kid ? FACE_CUT_KID : FACE_CUT),
          mate.badge !== null && FACE_PALE,
        )}
      >
        <MateFace
          className={kid ? "size-7" : "size-9"}
          greets
          known={mate.known}
          shape={mate.shape}
          size={kid ? 24 : 32}
          state={mate.face}
          tint={mate.tint}
        />
      </span>
      {mate.badge === null ? null : <MateOwnerMark seat={mate.badge} />}
      <RailDotMark dot={mate.dot} kid={kid} tint={mate.tint} />
    </span>
  );
}

/**
 * What a rail press draws, the menu's own looks: a tile, a group's kid, the menu's opener. Lit from
 * its press (`RailControl`, the kit's bare Button, `group/rail`), which holds the focus outline; the
 * ground a face's rings are cut in (`--menu-ground`) follows its light.
 */
const RAIL_LOOK = {
  tile: "flex w-18 flex-col items-center gap-1 rounded-card px-1 py-1.5 text-sidebar-foreground transition-colors duration-150 ease-out-strong group-hover/rail:bg-(--menu-rail-hover) group-hover/rail:[--menu-ground:var(--menu-rail-hover)] group-data-current/rail:bg-sidebar-row-active group-data-current/rail:[--menu-ground:var(--color-sidebar-row-active)] motion-reduce:transition-none",
  kid: "grid h-10 w-11 place-items-center rounded-control transition-colors duration-150 ease-out-strong group-hover/rail:bg-(--menu-rail-hover) group-hover/rail:[--menu-ground:var(--menu-rail-hover)] group-data-current/rail:bg-sidebar-row-active group-data-current/rail:[--menu-ground:var(--color-sidebar-row-active)] motion-reduce:transition-none",
  open: "grid size-8 place-items-center rounded-control text-sidebar-muted-foreground transition-colors duration-150 ease-out-strong group-hover/rail:bg-sidebar-row-hover group-hover/rail:text-sidebar-foreground motion-reduce:transition-none",
} as const;

/** A tile's name under its face: one line, cut where the tile ends. */
export const RAIL_NAME_CLASS = "w-full truncate text-center text-caption font-medium";

/** A rail press: the kit's bare press around its look, which keys its hover and current on it. */
export function RailControl({
  tip,
  look,
  children,
  ...button
}: {
  readonly tip: ReactNode;
  readonly look: keyof typeof RAIL_LOOK;
  readonly children: ReactNode;
} & Omit<ComponentProps<"button">, "className">) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button className="group/rail" variant="bare" {...button} />}>
        <span className={RAIL_LOOK[look]}>{children}</span>
      </TooltipTrigger>
      <TooltipPopup side="right">{tip}</TooltipPopup>
    </Tooltip>
  );
}

const mateLabel = (mate: RailMate) =>
  `${mate.projectName.length > 0 ? `${mate.name}, ${mate.projectName}` : mate.name}${
    mate.dot === undefined ? "" : `, ${railDotWords(mate.dot)}`
  }`;

const comingLabel = ({ member, stopped }: RailComing, projectName: string) => {
  const dot = comingDot(stopped);
  return `${projectName.length > 0 ? `${member.name}, ${projectName}` : member.name}${
    dot === undefined ? "" : `, ${railDotWords(dot)}`
  }`;
};

/**
 * A Mate being created, as its menu row wears it (`ComingMateRow`): the face its person picked
 * (slate where it picked none), waking while it comes up, asleep once its creation stopped.
 */
function RailComingFace({
  coming: { member, stopped },
  kid = false,
}: {
  readonly coming: RailComing;
  readonly kid?: boolean;
}) {
  const tint = member.face?.tint ?? "slate";
  return (
    <span className="relative grid size-9 place-items-center">
      <MateFace
        className={kid ? "size-7" : "size-9"}
        shape={member.face?.shape ?? mateShapeOf(undefined, tint)}
        size={kid ? 24 : 32}
        state={mateBirthFace(stopped)}
        tint={tint}
      />
      <RailDotMark dot={comingDot(stopped)} kid={kid} tint={tint} />
    </span>
  );
}

function RailTileView({
  tile,
  activeProjectId,
  onSelect,
  onOpenComing,
  onFold,
}: {
  readonly tile: RailTile<RailMate>;
  readonly activeProjectId: string | null;
  readonly onSelect: (projectId: string) => void;
  readonly onOpenComing: (projectId: string) => void;
  readonly onFold: ((groupId: string, open: boolean) => void) | null;
}) {
  const press = () => {
    const step = railTilePress(tile);
    if (step.fold !== undefined) onFold?.(step.fold.groupId, step.fold.open);
    if (step.select !== undefined) onSelect(step.select);
    if (step.open !== undefined) onOpenComing(step.open);
  };
  if (tile.kind === "coming") {
    const { member, projectName } = tile;
    return (
      <div
        aria-current={tile.current ? "true" : undefined}
        aria-label={projectName.length > 0 ? projectName : undefined}
        className="flex w-18 flex-none flex-col items-center gap-0.5 rounded-card"
        data-zerops-surface="sidebar-rail-project"
        role="group"
      >
        <RailControl
          aria-current={tile.current ? "page" : undefined}
          aria-label={comingLabel(tile, projectName)}
          look="tile"
          data-current={tile.current ? "" : undefined}
          data-zerops-surface="sidebar-rail-mate"
          onClick={press}
          tip={<RailTip line={projectName} name={member.name} />}
        >
          <RailComingFace coming={tile} />
          <span
            aria-hidden="true"
            className={RAIL_NAME_CLASS}
            data-zerops-surface="sidebar-rail-name"
          >
            {projectName.length > 0 ? projectName : member.name}
          </span>
        </RailControl>
      </div>
    );
  }
  if (tile.kind === "mate") {
    const { mate } = tile;
    const name = mate.projectName.length > 0 ? mate.projectName : mate.name;
    return (
      <div
        aria-current={tile.current ? "true" : undefined}
        aria-label={mate.projectName.length > 0 ? mate.projectName : undefined}
        className="flex w-18 flex-none flex-col items-center gap-0.5 rounded-card"
        data-zerops-surface="sidebar-rail-project"
        role="group"
      >
        <RailControl
          aria-current={tile.current ? "page" : undefined}
          aria-label={mateLabel(mate)}
          look="tile"
          data-current={tile.current ? "" : undefined}
          data-zerops-surface="sidebar-rail-mate"
          onClick={press}
          tip={<RailMateTip mate={mate} />}
        >
          <RailFace mate={mate} />
          <span
            aria-hidden="true"
            className={RAIL_NAME_CLASS}
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
      // Open, the project's Mates stand on its group's ground, which their faces cut out of.
      className="flex w-18 flex-none flex-col items-center gap-0.5 rounded-card data-rail-open:bg-rail-group data-rail-open:pb-1.5 data-rail-open:[--menu-ground:var(--color-rail-group)] data-rail-open:[--menu-rail-hover:var(--color-rail-group-hover)]"
      data-rail-open={tile.open ? "" : undefined}
      data-zerops-surface="sidebar-rail-project"
      role="group"
    >
      <RailControl
        aria-current={tile.current ? "page" : undefined}
        aria-expanded={tile.open}
        aria-label={`${name}, ${String(tile.mates.length + tile.coming.length)} Mates${
          tile.dot === undefined ? "" : `, ${railDotWords(tile.dot)}`
        }`}
        look="tile"
        data-current={tile.current ? "" : undefined}
        data-zerops-surface="sidebar-rail-group"
        onClick={press}
        tip={<RailGroupTip coming={tile.coming} mates={tile.mates} name={name} />}
      >
        <span className="relative grid size-9 place-items-center">
          <ProjectCluster
            faces={tile.faces.map((face) => {
              if (face.kind === "mate") {
                const { mate } = face;
                return {
                  projectId: mate.projectId,
                  name: mate.name,
                  tint: mate.tint,
                  shape: mate.shape,
                  state: mate.face,
                  known: mate.known,
                  badge: mate.badge,
                };
              }
              // As `RailComingFace` draws it.
              const { member, stopped } = face;
              const tint = member.face?.tint ?? "slate";
              return {
                projectId: member.projectId,
                name: member.name,
                tint,
                shape: member.face?.shape ?? mateShapeOf(undefined, tint),
                state: mateBirthFace(stopped),
                known: true,
                badge: null,
              };
            })}
            more={tile.more}
          />
          <RailDotMark dot={tile.dot} tint={working?.tint} />
        </span>
        <span
          aria-hidden="true"
          className={RAIL_NAME_CLASS}
          data-zerops-surface="sidebar-rail-name"
        >
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
                look="kid"
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
      {tile.open
        ? tile.coming.map((coming) => {
            const { member } = coming;
            const current = member.projectId === activeProjectId;
            return (
              <RailControl
                aria-current={current ? "page" : undefined}
                aria-label={comingLabel(coming, name)}
                look="kid"
                data-current={current ? "" : undefined}
                data-zerops-surface="sidebar-rail-mate"
                key={`coming:${member.intent ?? member.projectId}`}
                onClick={() => {
                  onOpenComing(member.projectId);
                }}
                tip={<RailTip line={name} name={member.name} />}
              >
                <RailComingFace coming={coming} kid />
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
  create,
  find,
  overviewCurrent,
  headline,
  waiting,
  verbs,
  account,
  showMark,
  openShortcut,
  onOverview,
  onSelect,
  onOpenComing,
  onFold,
  onOpenMenu,
}: {
  readonly tiles: ReadonlyArray<RailTile<RailMate>>;
  /** The Mate whose conversation is open. */
  readonly activeProjectId: string | null;
  /** The Chief's tile (`SidebarChiefTop`'s `tile`), the first; none where it is not listed. */
  readonly chief?: ReactNode;
  /** The +, beside Overview. */
  readonly create?: ReactNode;
  /** Search and whose Mates, under them, as the open menu's top row holds them. */
  readonly find?: ReactNode;
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
  /** Opens a Mate being created where it comes up, as its menu row's press does. */
  readonly onOpenComing: (projectId: string) => void;
  /** The menu's fold (`menuFolds.ts`); none while no menu is drawn under the rail. */
  readonly onFold: ((groupId: string, open: boolean) => void) | null;
  readonly onOpenMenu: () => void;
}) {
  const head = (
    <div className="flex flex-none justify-center px-1.5">
      <div className="relative grid">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-current={overviewCurrent ? "page" : undefined}
                aria-label="Overview"
                data-zerops-surface="sidebar-rail-overview"
                onClick={onOverview}
                size="icon-md"
                variant="sidebar"
              />
            }
          >
            <LayoutGridIcon aria-hidden="true" className="size-5" />
          </TooltipTrigger>
          <TooltipPopup side="right">
            <RailTip line={headline} name="Overview" shortcut="⌥0" />
          </TooltipPopup>
        </Tooltip>
        {waiting.length === 0 ? null : (
          <SidebarWaitingCount seat="rail" items={waiting} verbs={verbs} />
        )}
      </div>
      {create}
    </div>
  );
  return (
    // Cards open at once, and instantly from one tile to the next while moving along the rail.
    <TooltipProvider closeDelay={0} delay={80} timeout={700}>
      <div
        className="flex size-full min-h-0 flex-col items-center [--menu-ground:var(--color-sidebar)] [--menu-rail-hover:var(--color-sidebar-row-hover)]"
        data-zerops-surface="sidebar-rail"
      >
        {showMark ? (
          <div className="grid h-(--workspace-topbar-height) w-full flex-none place-items-center">
            {head}
          </div>
        ) : (
          <>
            <div className="h-(--workspace-topbar-height) w-full flex-none" />
            <div className="grid flex-none place-items-center pb-1">{head}</div>
          </>
        )}
        {find === undefined ? null : (
          // Straight under Overview and the +, as the design stacks the two rows.
          <div className={cn("flex flex-none justify-center px-1.5", showMark && "-mt-3")}>
            {find}
          </div>
        )}
        <div className="flex min-h-0 w-full flex-auto scrollbar-none flex-col items-center gap-0.5 overflow-y-auto overscroll-contain pt-2 pb-3">
          {chief}
          {tiles.map((tile) => (
            <RailTileView
              activeProjectId={activeProjectId}
              key={tile.key}
              onFold={onFold}
              onOpenComing={onOpenComing}
              onSelect={onSelect}
              tile={tile}
            />
          ))}
        </div>
        <div className="flex flex-none flex-col items-center gap-3 pt-2.5 pb-2">
          {account}
          <RailControl
            aria-label="Open the menu"
            look="open"
            data-zerops-surface="sidebar-rail-open"
            onClick={onOpenMenu}
            tip={<RailTip name="Open the menu" shortcut={openShortcut} />}
          >
            <PanelRightCloseIcon aria-hidden="true" className="size-4" />
          </RailControl>
        </div>
      </div>
    </TooltipProvider>
  );
}
