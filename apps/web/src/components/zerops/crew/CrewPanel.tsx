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
 *
 * The crew is exactly as closed as its conversations (D6, `crewAccess`): a
 * viewer who may not run its logins reads it, and is offered nothing that
 * runs or changes it — the composer's place says why, with the one way out.
 *
 * A Mate nobody has signed in has no crew to set up yet: the tab shows the one
 * "no agent yet" screen its conversation shows, word for word — its face,
 * "Sign Fen in to start." and the sign-in itself (`ZeropsMateEmptyState`).
 */
import {
  zeropsAgentAuthView,
  zeropsAgentSignInRequired,
} from "@t3tools/client-runtime/zerops/agentLogin";
import type { CrewAccess, CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { crewRefusalSentence } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentId, ScopedThreadRef, ZeropsAgentId } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { ReactNode } from "react";

import { ScrollArea } from "~/components/ui/scroll-area";
import { useServerConfigs, useThreadShells } from "~/state/entities";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { hasCrewSurface, useCrew, type CrewRead } from "~/zerops/crew/useCrew";
import { askMateThread, useAskMate } from "~/zerops/useAskMate";
import { useEnvironmentProjectRef, useZeropsAgentAuth } from "~/zerops/useZeropsFeeds";
import { useZeropsMate } from "~/zerops/useZeropsMates";

import { ZeropsMateEmptyState } from "../ZeropsMateEmptyState";
import { CrewSectionHost } from "./CrewSectionHost";

/** The Crew tab beside one conversation. */
export function CrewPanel({
  threadRef,
  onSignIn,
}: {
  readonly threadRef: ScopedThreadRef;
  /** The conversation's one sign-in dialog, opened on an agent. */
  readonly onSignIn: (agentId: ZeropsAgentId) => void;
}) {
  const { environmentId, threadId } = threadRef;
  const crew = useCrew(environmentId);
  const access = useCrewAccess(environmentId, crew.snapshot);
  const whoLivesHere = useZeropsMate(environmentId);
  const askMate = useAskMate();
  const projectId = useEnvironmentProjectRef(environmentId)?.projectId;
  const serverConfig = useServerConfigs().get(environmentId);
  const treeCwd = serverConfig?.cwd ?? null;
  // An ask for the Mate goes into this chat when it is a person chat, else the main one:
  // offered only where that chat is the viewer's to run.
  const askChat = askMateThread(
    useThreadShells().filter((thread) => thread.environmentId === environmentId),
    threadId,
  );
  const askLock = askChat === undefined ? null : access.login(askChat.modelSelection.instanceId);
  const agentAuth = zeropsAgentAuthView(useZeropsAgentAuth(environmentId)).snapshot;
  // No agent to run — none signed in, and none outside the sign-in ready: the Mate's sign-in.
  if (
    whoLivesHere.kind === "mate" &&
    agentAuth !== null &&
    zeropsAgentSignInRequired(agentAuth, serverConfig?.providers)
  ) {
    return (
      <div className="h-full" data-crew-panel="no-agent">
        <ZeropsMateEmptyState
          environmentId={environmentId}
          mate={whoLivesHere.mate}
          threadRef={threadRef}
        />
      </div>
    );
  }
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
      access={access}
      askLock={askLock}
      crew={crew}
      environmentId={environmentId}
      mate={mate}
      // Every draft for the Mate goes into the chat the tab is open beside
      // when it is a person chat, else the main one.
      onAskMate={(draft) => askMate(projectId, draft, { threadId })}
      onSignIn={(lock) => onSignIn(lock.agentId)}
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
  /** What this viewer may run or change on the crew (`useCrewAccess`). */
  readonly access: CrewAccess;
  /** The chat an ask for the Mate goes to is not this viewer's to run; `null` where it is. */
  readonly askLock: CrewLock | null;
  /** A closed crew's one way out: the viewer's own sign-in on its login's agent. */
  readonly onSignIn: (lock: CrewLock) => void;
}

/** The tab's column for the crew it is handed — what a harness draws too. */
export function CrewPanelBody({
  environmentId,
  crew,
  mate,
  treeCwd,
  onAskMate,
  access,
  askLock,
  onSignIn,
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
        access={access}
        askLock={askLock}
        current={crew.current}
        environmentId={environmentId}
        mate={mate}
        onAskMate={onAskMate}
        onSignIn={onSignIn}
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
        className="@container mx-auto flex min-h-full w-full max-w-3xl flex-col"
        data-crew-panel={status}
      >
        {children}
      </div>
    </ScrollArea>
  );
}
