/**
 * The composer drawer's ask for a value: the oldest the engine keeps open in the conversation, its
 * state off the project's vault, Save written as the person's vault write and then answered saved
 * (only the outcome reaches the engine), Not now answered declined. What the person said here is
 * kept in memory by the request, so the drawer folds at once and stays folded until the engine's
 * record says so too.
 */
import { NOT_READ_VAULT, vaultAtom } from "@t3tools/client-runtime/data";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback } from "react";
import { create } from "zustand";

import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useDetailDemand } from "~/zerops/ZeropsAccountData";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { ComposerVaultAsk, type ComposerVaultAskProps } from "./ComposerVaultAsk";
import { useVaultWriter } from "./VaultPanelContainer";
import { openVaultAsk, vaultAskState } from "./vaultRequest.logic";

const UNREAD = Atom.make(NOT_READ_VAULT);

/** What the person said to each ask here, by its request. Memory only. */
const useVaultAskAnswered = create<Readonly<Record<string, "saved" | "declined">>>()(() => ({}));

const answered = (requestId: string, outcome: "saved" | "declined" | null) =>
  useVaultAskAnswered.setState((state) => {
    if (outcome !== null) return { ...state, [requestId]: outcome };
    const { [requestId]: _gone, ...rest } = state;
    return rest;
  });

const selectOpenAsk = (detail: { readonly activities?: unknown } | null) =>
  openVaultAsk(detail?.activities as Parameters<typeof openVaultAsk>[0]);
const selectOpenId = (detail: { readonly activities?: unknown } | null) =>
  selectOpenAsk(detail)?.requestId ?? null;

/** The request the drawer holds: open in the engine, and not answered here yet. */
export function useOpenVaultAskId(threadRef: ScopedThreadRef | null): string | null {
  const open = useThreadDetail(threadRef, selectOpenId);
  const said = useVaultAskAnswered((state) => (open === null ? undefined : state[open]));
  return said === undefined ? open : null;
}

export function ComposerVaultAskContainer({
  threadRef,
  environmentId,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
}) {
  const open = useThreadDetail(threadRef, selectOpenAsk);
  const project = useZeropsEnvironmentProject(environmentId);
  const mate = useKnownMate(environmentId);
  const mateName = mate?.name ?? "Your Mate";
  const projectId = project?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const view = useAtomValue(projectId === null ? UNREAD : vaultAtom(projectId));
  const { write } = useVaultWriter(project, view);
  const answerVaultAsk = useAtomCommand(threadEnvironment.answerVaultAsk, {
    reportFailure: false,
  });
  const requestId = open?.requestId ?? null;
  /** Tells the engine how the ask ended; `null` once it took it, else why not. */
  const answer = useCallback(
    async (outcome: "saved" | "declined"): Promise<string | null> => {
      if (requestId === null) return null;
      // Not now folds at once; a save folds once the engine took it, so a refusal stays in view.
      if (outcome === "declined") answered(requestId, outcome);
      const result = await answerVaultAsk({
        environmentId,
        input: { threadId: threadRef.threadId, requestId, outcome },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
        answered(requestId, outcome);
        return null;
      }
      answered(requestId, null);
      const error = squashAtomCommandFailure(result);
      return error instanceof Error ? error.message : "The Mate did not take the answer.";
    },
    [answerVaultAsk, environmentId, requestId, threadRef.threadId],
  );
  const onSave = useCallback<ComposerVaultAskProps["onSave"]>(
    async (scope, vaultWrite) => {
      const { outcome, change } = await write(scope, vaultWrite);
      if (change === null) return outcome;
      const refused = await answer("saved");
      return refused === null
        ? outcome
        : {
            ok: false,
            code: "engine",
            message: `It is in the vault, but ${mateName} was not told: ${refused}`,
          };
    },
    [answer, mateName, write],
  );
  const onUseGiven = useCallback(() => void answer("saved"), [answer]);
  const onNotNow = useCallback(() => void answer("declined"), [answer]);
  if (open === null) return null;
  return (
    <ComposerVaultAsk
      ask={open.ask}
      key={open.requestId}
      mateName={mateName}
      onNotNow={onNotNow}
      onSave={onSave}
      onUseGiven={onUseGiven}
      state={vaultAskState(view, open.ask)}
    />
  );
}
