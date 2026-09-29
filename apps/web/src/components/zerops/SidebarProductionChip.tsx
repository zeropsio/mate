/**
 * A project's production as one chip on its heading, and the menu it opens
 * (M2, D1).
 *
 * The chip carries the four facts a person needs at a glance — that there is
 * a production, which release it serves, whether it is healthy, and what
 * waits to go out — and changes itself when production is in trouble: amber
 * while a release did not go through, red while it is down. It stays on the
 * heading when the project is folded. Its menu holds the rest: what went
 * wrong and the way to fix it (S6), the public links, the stages, what waits
 * for a release (Review), and the way to Zerops.
 *
 * What it says is `SidebarProductionChip.logic.ts`'s; this draws it.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { fixMatesOf } from "~/zerops/fixMates";
import { fixRequestPrompt, type FixProblem } from "~/zerops/fixRequest";
import { useOpenReview } from "~/zerops/review";

import { gatedPortal } from "../ui/portal-gate";
import { ZeropsMark } from "../ZeropsMark";
import { MateFace } from "./primitives";
import { routeMenuEntries } from "./ZeropsPublicRoutes";
import {
  chipFace,
  draftParts,
  type ChipDot,
  type ChipMenuModel,
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

export function SidebarProductionChip({
  chip,
  menu,
  projectName,
  groupId,
  stopProjectId,
  routes,
  fixProblem,
  mates,
  onAskToFix,
  onOpenStop,
}: {
  readonly chip: ProductionChip;
  /**
   * What the menu says as of a moment (`chipMenu`): the state in words, what
   * broke, the stages and how long ago each was deployed, what waits.
   */
  readonly menu: (nowMs: number) => ChipMenuModel;
  readonly projectName: string;
  readonly groupId: string;
  /** The chip's own stop's Zerops project, for *Open in Zerops*. */
  readonly stopProjectId: string | undefined;
  /** Where the chip's stop answers from outside. */
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  /** What "Ask <your Mate> to fix it" writes, while something is broken. */
  readonly fixProblem: FixProblem | undefined;
  readonly mates: ReadonlyArray<ChipMate>;
  /** Writes the problem into the Mate's composer, not sent; absent, no fix is offered. */
  readonly onAskToFix: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
  /** The stop's own page — its history — where one opens. */
  readonly onOpenStop: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const face = chipFace(chip);
  return (
    <PopoverPrimitive.Root onOpenChange={setOpen} open={open}>
      <PopoverPrimitive.Trigger
        render={
          <button
            aria-label={face.words}
            className="zerops-envchip relative z-1"
            data-tone={face.tone}
            data-zerops-surface="sidebar-production-chip"
            ref={trigger}
            type="button"
          />
        }
      >
        <EnvDot dot={face.dot} />
        <span className="zerops-envchip-label">{face.label}</span>
        {face.version === undefined ? null : (
          <span className="zerops-envchip-version">{face.version}</span>
        )}
        {face.extra === undefined ? null : (
          <span className="zerops-envchip-extra">{face.extra}</span>
        )}
      </PopoverPrimitive.Trigger>
      <ChipPortal>
        <PopoverPrimitive.Positioner align="end" className="z-130" side="bottom" sideOffset={6}>
          <PopoverPrimitive.Popup
            aria-label={`${projectName}: ${chip.label === "prod" ? "production" : "stage"}`}
            className="zerops-envpop"
            data-zerops-surface="sidebar-production-menu"
          >
            <ProductionMenu
              fixProblem={fixProblem}
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
              onOpenStop={
                onOpenStop === undefined
                  ? undefined
                  : () => {
                      setOpen(false);
                      onOpenStop();
                    }
              }
              onReview={() => {
                setOpen(false);
              }}
              projectName={projectName}
              reviewFrom={trigger}
              routes={routes}
              stopProjectId={stopProjectId}
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </ChipPortal>
    </PopoverPrimitive.Root>
  );
}

/** The chip's dot, and the same mark wherever a stop is listed (the jump box). */
export function EnvDot({ dot, className }: { readonly dot: ChipDot; readonly className?: string }) {
  return <span aria-hidden="true" className={cn("zerops-envdot", className)} data-dot={dot} />;
}

/**
 * The chip's menu, drawn from its model as of the moment it opens — the
 * heading drew the chip long before — and exported for the menu's own tests.
 */
export function ProductionMenu({
  menu,
  projectName,
  groupId,
  stopProjectId,
  routes,
  fixProblem,
  mates,
  onAskToFix,
  onOpenStop,
  onReview,
  reviewFrom,
}: {
  readonly menu: (nowMs: number) => ChipMenuModel;
  readonly projectName: string;
  readonly groupId: string;
  readonly stopProjectId: string | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly fixProblem: FixProblem | undefined;
  readonly mates: ReadonlyArray<ChipMate>;
  readonly onAskToFix: ((mateProjectId: string, problem: FixProblem) => void) | undefined;
  readonly onOpenStop: (() => void) | undefined;
  /** The review opened: the menu gives way to it. */
  readonly onReview: () => void;
  /** What the review opens from, and gives the focus back to. */
  readonly reviewFrom: { readonly current: HTMLElement | null };
}) {
  const openReview = useOpenReview();
  // Drawn only while open, so this is the moment it opened.
  const [openedAt] = useState(Date.now);
  const model = menu(openedAt);
  const { main } = model;
  const mainRow = (
    <>
      <EnvDot dot={main.dot} />
      <span className="min-w-0 truncate">
        <b className="font-medium">{main.name}</b>
        {main.version === undefined ? null : (
          <span className="zerops-envpop-version">{main.version}</span>
        )}
      </span>
      <span className="zerops-envpop-word" data-tone={main.tone}>
        {main.word}
      </span>
    </>
  );
  return (
    <div className="flex flex-col">
      <h5 className="zerops-envpop-title">{projectName}</h5>
      {onOpenStop === undefined ? (
        <div className="zerops-envpop-stop" data-zerops-surface="sidebar-production-main">
          {mainRow}
        </div>
      ) : (
        <button
          className="zerops-envpop-stop zerops-envpop-press"
          data-zerops-surface="sidebar-production-main"
          onClick={onOpenStop}
          type="button"
        >
          {mainRow}
        </button>
      )}
      {model.note === undefined ? null : (
        <p className="zerops-envpop-note" data-zerops-surface="sidebar-production-note">
          {model.note}
        </p>
      )}
      {!model.trouble || fixProblem === undefined || onAskToFix === undefined ? null : (
        <AskToFix
          groupId={groupId}
          mates={mates}
          onAsk={onAskToFix}
          problem={fixProblem}
          projectId={stopProjectId}
        />
      )}
      {routeMenuEntries(routes).map((entry) => (
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
      {model.stages.map((stage) => (
        <div
          className="zerops-envpop-stop"
          data-zerops-surface="sidebar-production-stage"
          key={stage.name}
        >
          <EnvDot dot={stage.dot} />
          <span className="min-w-0 truncate">
            <b className="font-medium">{stage.name}</b>
            {stage.version === undefined ? null : (
              <span className="zerops-envpop-version">{stage.version}</span>
            )}
          </span>
          <span className="zerops-envpop-word" data-tone="muted">
            {stage.word}
          </span>
        </div>
      ))}
      {model.waiting === 0 ? null : (
        <>
          <Separator />
          <div className="zerops-envpop-act" data-zerops-surface="sidebar-production-waiting">
            <span className="min-w-0 truncate tabular-nums">
              {model.waiting === 1
                ? "1 change waits for production"
                : `${String(model.waiting)} changes wait for production`}
            </span>
            <button
              className="zerops-envpop-review"
              data-zerops-surface="sidebar-production-review"
              onClick={() => {
                onReview();
                openReview({ kind: "release", groupId }, { from: reviewFrom.current });
              }}
              type="button"
            >
              Review
            </button>
          </div>
        </>
      )}
      {stopProjectId === undefined ? null : (
        <>
          <Separator />
          <a
            className="zerops-envpop-act zerops-envpop-press"
            data-zerops-surface="sidebar-production-zerops"
            href={zeropsProjectUrl(stopProjectId)}
            rel="noreferrer"
            target="_blank"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ZeropsMark className="size-3.25 shrink-0" />
              Open in Zerops
            </span>
            <ArrowUpRightIcon aria-hidden="true" className="size-3.25 shrink-0" />
          </a>
        </>
      )}
    </div>
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
  /** The project the problem is in: the chip's own stop's. */
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
