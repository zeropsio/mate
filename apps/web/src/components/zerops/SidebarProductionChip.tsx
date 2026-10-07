/**
 * A project's production and its stages as two chips on its heading — `prod`
 * and `stage` — and the menu each opens (M2, D1).
 *
 * A chip is its word alone. Its whole ground and ink say what is wrong: amber
 * while the last release or deploy did not go through and the old one still
 * serves, red while it is down, hollow while it is stopped on purpose,
 * neutral otherwise; a tone change cross-fades, and nothing else about it
 * ever moves or changes size. It stays on the heading when the project is
 * folded. Its menu holds the rest: the state in words and what it runs, what
 * went wrong and the way to fix it (S6), the public links, what waits for a
 * release (Review), and the way to Zerops — for each stage, on the stages'.
 *
 * What it says is `SidebarProductionChip.logic.ts`'s; this draws it.
 */
import { usePublicAccess } from "~/zerops/usePublicAccess";
import { StopPublicAccessStatus } from "./StopPublicAccess";
import { StopReadAgain } from "./StopReadAgain";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { Fragment, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { fixMatesOf } from "~/zerops/fixMates";
import { fixRequestPrompt, type FixProblem } from "~/zerops/fixRequest";

import { gatedPortal } from "../ui/portal-gate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ZeropsMark } from "../ZeropsMark";
import { MateFace } from "./primitives";
import { routeMenuEntries } from "./ZeropsPublicRoutes";
import {
  chipFace,
  draftParts,
  type ChipDot,
  type ChipMenuModel,
  type ChipMenuStop,
  type ProductionChip,
} from "./SidebarProductionChip.logic";

const ChipPortal = gatedPortal(PopoverPrimitive.Portal);

/** One of the project's Mates, as the fix may be offered to it (S6, `fixMatesOf`). */
export interface ChipMate {
  readonly candidate: ZeropsCandidate;
  readonly tint: MateTintId;
  /** The shape its person picked, else its tint's own (`mateShapeOf`). */
  readonly shape: MateShapeId;
  /** Whether it is the person's own; `undefined` where nobody can say yet. */
  readonly mine: boolean | undefined;
  /** Its conversation's key, whose last visit puts the one used last first. */
  readonly threadKey: string | undefined;
}

/** A stop's own page — its history — where one opens; `undefined` where none does. */
type OpenStop = (projectId: string) => (() => void) | undefined;

export function SidebarProductionChip({
  chip,
  menu,
  projectName,
  groupId,
  stops,
  mates,
  onAskToFix,
  onOpenStop,
  onReviewRelease,
}: {
  readonly chip: ProductionChip;
  /**
   * What its menu says as of a moment (`productionMenu`, `stageMenu`): each
   * stop's state in words, what broke, its links, what waits.
   */
  readonly menu: (nowMs: number) => ChipMenuModel;
  readonly projectName: string;
  readonly groupId: string;
  /** The Zerops projects it stands for: where a find in the jump box lands. */
  readonly stops: ReadonlyArray<string>;
  readonly mates: ReadonlyArray<ChipMate>;
  /** Writes the problem into the Mate's composer, not sent; absent, no fix is offered. */
  readonly onAskToFix: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
  readonly onOpenStop: OpenStop;
  /** Opens the release review only when HQ navigation offers it. */
  readonly onReviewRelease?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const face = chipFace(chip);
  return (
    <PopoverPrimitive.Root onOpenChange={setOpen} open={open}>
      {/* Its state in words before a press (D): the pill's word alone says only which place. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverPrimitive.Trigger
              render={
                <button
                  aria-label={face.words}
                  className="zerops-envchip relative z-1"
                  data-tone={face.tone}
                  data-zerops-chip={chip.label}
                  data-zerops-stops={stops.join(" ")}
                  data-zerops-surface="sidebar-production-chip"
                  ref={trigger}
                  type="button"
                />
              }
            />
          }
        >
          {face.label}
        </TooltipTrigger>
        {open ? null : <TooltipPopup side="bottom">{face.words}</TooltipPopup>}
      </Tooltip>
      <ChipPortal>
        <PopoverPrimitive.Positioner align="end" className="z-130" side="bottom" sideOffset={6}>
          <PopoverPrimitive.Popup
            aria-label={`${projectName}: ${
              chip.label === "prod"
                ? "production"
                : (chip.stages?.length ?? 1) > 1
                  ? "stages"
                  : "stage"
            }`}
            className="zerops-envpop"
            data-zerops-surface="sidebar-production-menu"
          >
            <ChipMenu
              groupId={groupId}
              mates={mates}
              menu={menu}
              onAskToFix={
                onAskToFix === undefined
                  ? undefined
                  : (mateProjectId, problem) => {
                      setOpen(false);
                      onAskToFix(mateProjectId, problem);
                    }
              }
              onOpenStop={(projectId) => {
                const opens = onOpenStop(projectId);
                return opens === undefined
                  ? undefined
                  : () => {
                      setOpen(false);
                      opens();
                    };
              }}
              onReviewRelease={
                onReviewRelease === undefined
                  ? undefined
                  : () => {
                      setOpen(false);
                      onReviewRelease();
                    }
              }
              projectName={projectName}
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </ChipPortal>
    </PopoverPrimitive.Root>
  );
}

/** A stop's dot in a chip's menu, and the same mark wherever a stop is listed (the jump box). */
export function EnvDot({ dot, className }: { readonly dot: ChipDot; readonly className?: string }) {
  return <span aria-hidden="true" className={cn("zerops-envdot", className)} data-dot={dot} />;
}

/**
 * A chip's menu, drawn from its model as of the moment it opens — the
 * heading drew the chip long before — and exported for the menu's own tests.
 * One stop reads as production's always has, *Open in Zerops* last; several
 * are each a group of their own, each with its own way to Zerops.
 */
export function ChipMenu({
  menu,
  projectName,
  groupId,
  mates,
  onAskToFix,
  onOpenStop,
  onReviewRelease,
}: {
  readonly menu: (nowMs: number) => ChipMenuModel;
  readonly projectName: string;
  readonly groupId: string;
  readonly mates: ReadonlyArray<ChipMate>;
  readonly onAskToFix: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
  readonly onOpenStop: OpenStop;
  /** Opens the release review only when HQ navigation offers it. */
  readonly onReviewRelease?: (() => void) | undefined;
}) {
  // Drawn only while open, so this is the moment it opened.
  const [openedAt] = useState(Date.now);
  const model = menu(openedAt);
  const alone = model.stops.length === 1 ? model.stops[0] : undefined;
  return (
    <div className="flex flex-col">
      <h5 className="zerops-envpop-title">{projectName}</h5>
      {model.stops.map((stop, index) => (
        <Fragment key={stop.projectId ?? `coming:${stop.name}`}>
          {index === 0 ? null : <Separator />}
          <StopGroup
            groupId={groupId}
            mates={mates}
            onAskToFix={onAskToFix}
            onOpenStop={onOpenStop}
            ownZerops={alone === undefined}
            stop={stop}
          />
        </Fragment>
      ))}
      {onReviewRelease === undefined ? null : (
        <button
          className="zerops-envpop-stop zerops-envpop-press"
          data-zerops-surface="sidebar-production-review"
          onClick={onReviewRelease}
          type="button"
        >
          Review release
        </button>
      )}
      {alone?.projectId === undefined ? null : (
        <>
          <Separator />
          <OpenInZerops projectId={alone.projectId} />
        </>
      )}
    </div>
  );
}

/**
 * One stop in a chip's menu: its row — which opens its page, where one opens
 * — what went wrong, the fix while it is broken (S6), its public links led by
 * their service, and, among several, its own way to Zerops.
 */
function StopGroup({
  stop,
  groupId,
  mates,
  onAskToFix,
  onOpenStop,
  ownZerops,
}: {
  readonly stop: ChipMenuStop;
  readonly groupId: string;
  readonly mates: ReadonlyArray<ChipMate>;
  readonly onAskToFix: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
  readonly onOpenStop: OpenStop;
  readonly ownZerops: boolean;
}) {
  const publicAccess = usePublicAccess(stop.projectId);
  const opens = stop.projectId === undefined ? undefined : onOpenStop(stop.projectId);
  const row = (
    <>
      <EnvDot dot={stop.dot} />
      <span className="min-w-0 truncate">
        <b className="font-medium">{stop.name}</b>
        {stop.version === undefined ? null : (
          <span className="zerops-envpop-version">{stop.version}</span>
        )}
      </span>
      <span className="zerops-envpop-word" data-tone={stop.tone}>
        {stop.word}
      </span>
    </>
  );
  return (
    <>
      {opens === undefined ? (
        <div className="zerops-envpop-stop" data-zerops-surface="sidebar-production-main">
          {row}
        </div>
      ) : (
        <button
          className="zerops-envpop-stop zerops-envpop-press"
          data-zerops-surface="sidebar-production-main"
          onClick={opens}
          type="button"
        >
          {row}
        </button>
      )}
      {stop.projectId === undefined ? null : <StopReadAgain projectId={stop.projectId} />}
      {stop.note === undefined ? null : (
        <p className="zerops-envpop-note" data-zerops-surface="sidebar-production-note">
          {stop.note}
        </p>
      )}
      {stop.fix === undefined || onAskToFix === undefined ? null : (
        <AskToFix
          groupId={groupId}
          mates={mates}
          onAsk={onAskToFix}
          problem={stop.fix}
          projectId={stop.projectId}
        />
      )}
      <StopPublicAccessStatus access={publicAccess} />
      {routeMenuEntries(publicAccess.bound ? publicAccess.routes : stop.routes).map((entry) => (
        <a
          className="zerops-envpop-link"
          data-zerops-surface="sidebar-production-link"
          href={entry.url}
          key={entry.key}
          rel="noreferrer"
          target="_blank"
        >
          <span className="zerops-envpop-service">
            {entry.service}
            {entry.port === undefined ? null : (
              <span className="zerops-envpop-port">:{entry.port}</span>
            )}
          </span>
          <span className="min-w-0 truncate">{entry.host}</span>
          <ArrowUpRightIcon aria-hidden="true" className="size-3.25 shrink-0" />
        </a>
      ))}
      {ownZerops && stop.projectId !== undefined ? (
        <OpenInZerops projectId={stop.projectId} />
      ) : null}
    </>
  );
}

function OpenInZerops({ projectId }: { readonly projectId: string }) {
  return (
    <a
      className="zerops-envpop-act zerops-envpop-press"
      data-zerops-surface="sidebar-production-zerops"
      href={zeropsProjectUrl(projectId)}
      rel="noreferrer"
      target="_blank"
    >
      <span className="flex min-w-0 items-center gap-2">
        <ZeropsMark className="size-3.25 shrink-0" />
        Open in Zerops
      </span>
      <ArrowUpRightIcon aria-hidden="true" className="size-3.25 shrink-0" />
    </a>
  );
}

function Separator() {
  return <div aria-hidden="true" className="zerops-envpop-separator" />;
}

/**
 * "Ask <your Mate> to fix it" (S6): the person's own Mates only — one nobody
 * can say is someone else's counts as theirs, as the menu's *Mine* keeps it —
 * the one used last first, a chevron for another (`fixMatesOf`). The first
 * press shows what will be written into the Mate's composer — nothing is sent
 * from here — and the second opens its conversation with it there.
 */
function AskToFix({
  problem,
  mates,
  groupId,
  projectId,
  onAsk,
}: {
  readonly problem: FixProblem;
  readonly mates: ReadonlyArray<ChipMate>;
  readonly groupId: string;
  /** The project the problem is in: its stop's. */
  readonly projectId: string | undefined;
  readonly onAsk: (mateProjectId: string, problem: FixProblem) => void;
}) {
  const visited = useUiStateStore((state) => state.threadLastVisitedAtById);
  const faces = new Map(mates.map((mate) => [mate.candidate.project.id, mate]));
  const choice = fixMatesOf({
    projectId: projectId ?? groupId,
    groupId,
    candidates: mates.map((mate) => mate.candidate),
    isMine: (candidate) =>
      mates.find((mate) => mate.candidate.project.id === candidate.project.id)?.mine,
    visitedAt: (environmentId) => {
      const mate = mates.find((entry) => entry.candidate.environmentId === environmentId);
      return mate?.threadKey === undefined ? undefined : visited[mate.threadKey];
    },
  }).map((option) => {
    const face = faces.get(option.mateProjectId);
    return { ...option, tint: face?.tint ?? "slate", shape: face?.shape };
  });
  const [pickedId, setPickedId] = useState<string | undefined>(undefined);
  const [drafting, setDrafting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const mate = choice.find((entry) => entry.mateProjectId === pickedId) ?? choice[0];
  // None of the person's own: nobody writes to a colleague's Mate.
  if (mate === undefined) return null;
  const others = choice.filter((entry) => entry !== mate);
  return (
    <div className="zerops-envpop-ask" data-zerops-surface="sidebar-production-ask">
      <div className="flex items-center gap-1">
        <button
          aria-expanded={drafting}
          className="zerops-envpop-askbutton"
          data-zerops-surface="sidebar-production-ask-button"
          onClick={() => {
            setDrafting(!drafting);
          }}
          type="button"
        >
          <MateFace
            className="size-4.5"
            shape={mate.shape}
            size="sm"
            state="idle"
            tint={mate.tint}
          />
          {`Ask ${mate.name} to fix it`}
        </button>
        {others.length === 0 ? null : (
          <button
            aria-expanded={choosing}
            aria-label="Ask another of your Mates"
            className="zerops-envpop-askmore"
            onClick={() => {
              setChoosing(!choosing);
            }}
            type="button"
          >
            <ChevronDownIcon aria-hidden="true" className="size-3.5" />
          </button>
        )}
      </div>
      {choosing ? (
        <div className="zerops-envpop-others" role="group" aria-label="Your other Mates">
          {others.map((other) => (
            <button
              className="zerops-envpop-other"
              key={other.mateProjectId}
              onClick={() => {
                setPickedId(other.mateProjectId);
                setChoosing(false);
              }}
              type="button"
            >
              <MateFace
                className="size-4.5"
                shape={other.shape}
                size="sm"
                state="idle"
                tint={other.tint}
              />
              {other.name}
            </button>
          ))}
        </div>
      ) : null}
      {drafting ? (
        <div className="zerops-envpop-draft" data-zerops-surface="sidebar-production-draft">
          <div className="zerops-envpop-draft-to">
            <MateFace
              className="size-3.5"
              shape={mate.shape}
              size="dot"
              state="idle"
              tint={mate.tint}
            />
            {`Opens ${mate.name}'s conversation with this in the composer`}
          </div>
          {draftParts(fixRequestPrompt(problem)).map((part): ReactNode =>
            part.kind === "code" ? (
              <pre key={`code:${part.text}`}>{part.text}</pre>
            ) : (
              <p key={`words:${part.text}`}>{part.text}</p>
            ),
          )}
          <button
            className="zerops-envpop-askbutton"
            data-zerops-surface="sidebar-production-ask-open"
            onClick={() => {
              onAsk(mate.mateProjectId, problem);
            }}
            type="button"
          >
            {`Open ${mate.name}'s conversation`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
