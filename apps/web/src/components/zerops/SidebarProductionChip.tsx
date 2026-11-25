/**
 * What a project's places offer in the globe's popover (`SidebarProjectSites.tsx`): a stop's dot,
 * the way to Zerops, and "Ask <your Mate> to fix it" (S6) — and the portal the popovers open in.
 *
 * What a place says is `SidebarProductionChip.logic.ts`'s; this draws its parts.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/gui";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useUiStateStore } from "~/uiStateStore";
import { fixMatesOf } from "~/zerops/fixMates";
import { fixRequestPrompt, type FixProblem } from "~/zerops/fixRequest";

import { Badge, type BadgeTone } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Row } from "../ui/row";
import { ZeropsMark } from "../ZeropsMark";
import { MateFace } from "./primitives";
import { draftParts, type ChipDot } from "./SidebarProductionChip.logic";
import { Text } from "~/components/ui/text";

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

const ENV_DOT_TONE = {
  ok: "success",
  attention: "warning",
  failed: "danger",
  off: "neutral",
  spinner: "info",
} as const satisfies Partial<Record<ChipDot, BadgeTone>>;

/**
 * A stop's dot in its place's head, and the same mark wherever a stop is listed (the jump box),
 * named by the stop's word. A stop at rest on purpose is hollow, one on its way the busy tone.
 */
export function EnvDot({ dot, label }: { readonly dot: ChipDot; readonly label: string }) {
  return dot === "hollow" ? (
    <Badge aria-label={label} dot hollow />
  ) : (
    <Badge aria-label={label} dot tone={ENV_DOT_TONE[dot]} />
  );
}

export function OpenInZerops({ projectId }: { readonly projectId: string }) {
  return (
    <Row
      data-zerops-surface="sidebar-production-zerops"
      lead={<ZeropsMark className="size-3.5" />}
      meta={<ArrowUpRightIcon aria-hidden="true" className="size-3.5" />}
      pressable
      render={<a href={zeropsProjectUrl(projectId)} rel="noreferrer" target="_blank" />}
      size="xs"
      title="Open in Zerops"
    />
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
    <div
      className="ms-8 me-1.5 mt-1 mb-2 flex flex-col gap-1.5"
      data-zerops-surface="sidebar-production-ask"
    >
      <div className="flex items-center gap-1">
        <Button
          aria-expanded={drafting}
          data-zerops-surface="sidebar-production-ask-button"
          onClick={() => {
            setDrafting(!drafting);
          }}
          size="sm"
          variant="secondary"
        >
          <MateFace
            className="size-4.5"
            shape={mate.shape}
            size={20}
            state="idle"
            tint={mate.tint}
          />
          {`Ask ${mate.name} to fix it`}
        </Button>
        {others.length === 0 ? null : (
          <Button
            aria-expanded={choosing}
            aria-label="Ask another of your Mates"
            onClick={() => {
              setChoosing(!choosing);
            }}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        )}
      </div>
      {choosing ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Your other Mates">
          {others.map((other) => (
            <Button
              key={other.mateProjectId}
              onClick={() => {
                setPickedId(other.mateProjectId);
                setChoosing(false);
              }}
              size="sm"
              variant="ghost"
            >
              <MateFace
                className="size-4.5"
                shape={other.shape}
                size={20}
                state="idle"
                tint={other.tint}
              />
              {other.name}
            </Button>
          ))}
        </div>
      ) : null}
      {drafting ? (
        // The words that go into the Mate's composer: long hosts and paths break anywhere rather
        // than widen the popover, and the card rises in as it opens.
        <div className="leading-4.75 wrap-anywhere motion-safe:animate-envpop-rise">
          <Card data-zerops-surface="sidebar-production-draft" size="sm">
            <Text className="flex items-center gap-1.5" render={<div />} variant="label">
              <MateFace shape={mate.shape} size={16} state="idle" tint={mate.tint} />
              {`Opens ${mate.name}'s conversation with this in the composer`}
            </Text>
            {draftParts(fixRequestPrompt(problem)).map((part): ReactNode =>
              part.kind === "code" ? (
                <pre
                  className="rounded-mark bg-card-foreground/7 px-2 py-1.5 font-mono text-caption whitespace-pre-wrap text-card-foreground/76"
                  key={`code:${part.text}`}
                >
                  {part.text}
                </pre>
              ) : (
                <p key={`words:${part.text}`}>{part.text}</p>
              ),
            )}
            <Button
              className="self-start"
              data-zerops-surface="sidebar-production-ask-open"
              onClick={() => {
                onAsk(mate.mateProjectId, problem);
              }}
              size="sm"
            >
              {`Open ${mate.name}'s conversation`}
            </Button>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
