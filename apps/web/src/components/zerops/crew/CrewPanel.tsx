/**
 * The Crew tab — right-panel kind `crew` — the crew's one home (the owner,
 * 2026-09-29: "shouldn't we put the 'setup crew' screen from the zerops tab to
 * the 'crew' tab?"). It is offered for every Mate whose crew mode is on, crew
 * or not (`rightPanelKinds.ts`), so setting one up has a home: a Mate with no
 * crew has its empty state and *Set up a crew*; a crew is one column — its
 * goal and how it works, the composer, a row per crewmate, and what went into
 * the Mate's code — or, in its place, one of its views (`CrewSectionHost`).
 *
 * A tab kept open after crew mode went off says so; a feed not read yet draws
 * nothing.
 */
import { crewRefusalSentence } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { useServerConfigs } from "~/state/entities";
import { hasCrewSurface, useCrew, type CrewRead } from "~/zerops/crew/useCrew";
import { useAskMate } from "~/zerops/useAskMate";
import { useEnvironmentProjectRef } from "~/zerops/useZeropsFeeds";
import { useZeropsMate } from "~/zerops/useZeropsMates";

import { CrewSectionHost } from "./CrewSectionHost";

/** The Crew tab beside one conversation. */
export function CrewPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const crew = useCrew(environmentId);
  const whoLivesHere = useZeropsMate(environmentId);
  const askMate = useAskMate();
  const projectId = useEnvironmentProjectRef(environmentId)?.projectId;
  const treeCwd = useServerConfigs().get(environmentId)?.cwd ?? null;
  const mate =
    whoLivesHere.kind === "mate"
      ? {
          name: whoLivesHere.mate.name,
          tint: whoLivesHere.mate.tint,
          shape: whoLivesHere.mate.shape,
        }
      : undefined;
  return (
    <CrewPanelBody
      crew={crew}
      environmentId={environmentId}
      mate={mate}
      // Every draft for the Mate goes into the chat the tab is open beside
      // when it is a person chat, else the main one.
      onAskMate={(draft) => askMate(projectId, draft, { threadId })}
      treeCwd={treeCwd}
    />
  );
}

export interface CrewPanelBodyProps {
  readonly environmentId: EnvironmentId;
  /** The crew as its feed reads it (`useCrew`). */
  readonly crew: CrewRead;
  /** The Mate who lives here, named wherever the crew's words name it. */
  readonly mate:
    | { readonly name: string; readonly tint: MateTintId; readonly shape?: MateShapeId }
    | undefined;
  /** The Mate's tree, where the composer's `@` finds files; `null` while unread. */
  readonly treeCwd: string | null;
  /** Hands the Mate a draft, confirmed first by the tab. */
  readonly onAskMate: (draft: string) => void;
}

/** The tab's column for the crew it is handed — what a harness draws too. */
export function CrewPanelBody({
  environmentId,
  crew,
  mate,
  treeCwd,
  onAskMate,
}: CrewPanelBodyProps) {
  if (crew.status === null) return null;
  if (!hasCrewSurface(crew.status) || crew.snapshot === null) {
    return (
      <p className="p-4 text-muted-foreground text-sm" data-crew-panel="off">
        {crewRefusalSentence("unavailable", null)}
      </p>
    );
  }
  return (
    <CrewPanelFrame status={crew.status}>
      <CrewSectionHost
        current={crew.current}
        environmentId={environmentId}
        mate={mate}
        onAskMate={onAskMate}
        snapshot={crew.snapshot}
        treeCwd={treeCwd}
        view={crew.status === "applied" ? crew.view : null}
      />
    </CrewPanelFrame>
  );
}

/** The tab's scrolling column, the host in it — and a harness's view, drawn alone. */
export function CrewPanelFrame({
  status,
  children,
}: {
  readonly status: "none" | "applied";
  readonly children: ReactNode;
}) {
  return (
    <ScrollArea className="h-full">
      <div
        className="@container flex min-h-full w-full max-w-3xl flex-col"
        data-crew-panel={status}
      >
        {children}
      </div>
    </ScrollArea>
  );
}
