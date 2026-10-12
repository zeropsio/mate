/**
 * What a project's places offer in the globe's popover (`SidebarProjectSites.tsx`): a stop's dot,
 * the way to Zerops, and "Ask <your Mate> to fix it" (S6) — and the portal the popovers open in.
 *
 * What a place says is `SidebarProductionChip.logic.ts`'s; this draws its parts.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/serviceMap";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { fixMatesOf } from "~/zerops/fixMates";
import { fixRequestPrompt, type FixProblem } from "~/zerops/fixRequest";

import { gatedPortal } from "../ui/portal-gate";
import { ZeropsMark } from "../ZeropsMark";
import { MateFace } from "./primitives";
import { draftParts, type ChipDot } from "./SidebarProductionChip.logic";

export const ChipPortal = gatedPortal(PopoverPrimitive.Portal);

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

/** A stop's dot in its place's head, and the same mark wherever a stop is listed (the jump box). */
export function EnvDot({ dot, className }: { readonly dot: ChipDot; readonly className?: string }) {
  return <span aria-hidden="true" className={cn("zerops-envdot", className)} data-dot={dot} />;
}

export function OpenInZerops({ projectId }: { readonly projectId: string }) {
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

/**
 * "Ask <your Mate> to fix it" (S6): the person's own Mates only — one nobody
 * can say is someone else's counts as theirs, as the menu's *Mine* keeps it —
 * the one used last first, a chevron for another (`fixMatesOf`). The first
 * press shows what will be written into the Mate's composer — nothing is sent
 * from here — and the second opens its conversation with it there.
 */
export function AskToFix({
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
