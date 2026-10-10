/**
 * A request for a vault value as a conversation draws it: the ask read off the Mate's
 * `zerops_env action=request` call, its state off its environment's project vault — held while
 * the card is drawn, so it reads with the Vault panel closed — and a put submitted as the panel
 * submits it, as the person. On a conversation the engine keeps, the ask is its record: Save
 * writes the value, then tells the engine only that it was saved; Decline tells it declined; the
 * engine resumes the Mate. Elsewhere the put is kept for the Mate's next message
 * (`recordVaultWrite`). What the person said here is kept in memory by the call, so a card the
 * list draws again says it still. The value lives in the field and the write, nowhere else.
 */
import { NOT_READ_VAULT, vaultAtom } from "@t3tools/client-runtime/data";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo } from "react";
import { create } from "zustand";

import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useDetailDemand } from "~/zerops/ZeropsAccountData";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { recordVaultWrite } from "~/zerops/vaultTurnNotes";
import { useVaultWriter } from "./VaultPanelContainer";
import { VaultRequestCard, type VaultRequestCardProps } from "./VaultRequestCard";
import {
  type VaultAsk,
  type VaultAskSaid,
  engineVaultAskFor,
  vaultAskOf,
  vaultAskPickUp,
  vaultAskState,
} from "./vaultRequest.logic";

const UNREAD = Atom.make(NOT_READ_VAULT);

/** What the person said to each ask here, by its operation's key. Memory only. */
const useVaultAskSaid = create<Readonly<Record<string, VaultAskSaid>>>()(() => ({}));

function say(operationKey: string, said: VaultAskSaid): void {
  useVaultAskSaid.setState((state) => ({ ...state, [operationKey]: said }));
}

function unsay(operationKey: string): void {
  useVaultAskSaid.setState((state) => {
    const { [operationKey]: _said, ...rest } = state;
    return rest;
  });
}

/** The card for an operation that asks the person for a value; nothing for any other. */
export function VaultRequestCardContainer({
  operation,
  environmentId,
  threadRef,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const ask = useMemo(() => vaultAskOf(operation), [operation]);
  if (ask === null || environmentId === null) return null;
  return (
    <AskCard
      ask={ask}
      environmentId={environmentId}
      operationKey={operation.key}
      threadRef={threadRef}
    />
  );
}

/** The engine's record of an ask, as one string so a thread's other changes draw nothing here. */
const engineKeyOf = (ask: VaultAsk) => (detail: { readonly activities?: unknown } | null) => {
  const found = engineVaultAskFor(
    detail?.activities as Parameters<typeof engineVaultAskFor>[0],
    ask,
  );
  return found === null ? null : `${found.state} ${found.requestId}`;
};

function AskCard({
  ask,
  environmentId,
  operationKey,
  threadRef,
}: {
  readonly ask: VaultAsk;
  readonly environmentId: EnvironmentId;
  readonly operationKey: string;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const project = useZeropsEnvironmentProject(environmentId);
  const mate = useKnownMate(environmentId);
  const projectId = project?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const view = useAtomValue(projectId === null ? UNREAD : vaultAtom(projectId));
  const said = useVaultAskSaid((state) => state[operationKey] ?? null);
  const engineKey = useThreadDetail(
    threadRef,
    useMemo(() => engineKeyOf(ask), [ask]),
  );
  const [engineState, requestId] =
    engineKey === null
      ? [null, null]
      : (engineKey.split(" ") as [VaultRequestCardProps["engine"] & string, string]);
  const answerVaultAsk = useAtomCommand(threadEnvironment.answerVaultAsk, {
    reportFailure: false,
  });
  /** Tells the engine how the ask ended; `null` once it took it, else why not. */
  const answer = useCallback(
    async (outcome: "saved" | "declined"): Promise<string | null> => {
      if (requestId === null || threadRef === null) return null;
      const result = await answerVaultAsk({
        environmentId,
        input: { threadId: threadRef.threadId, requestId, outcome },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
      const error = squashAtomCommandFailure(result);
      return error instanceof Error ? error.message : "The Mate did not take the answer.";
    },
    [answerVaultAsk, environmentId, requestId, threadRef],
  );
  const { write } = useVaultWriter(project, view);
  const onPut = useCallback<VaultRequestCardProps["onPut"]>(
    async (scope, vaultWrite) => {
      const { outcome, change } = await write(scope, vaultWrite);
      if (change === null || projectId === null) return outcome;
      if (requestId === null) {
        recordVaultWrite(projectId, change);
        say(operationKey, "put");
        return outcome;
      }
      const refused = await answer("saved");
      if (refused !== null) {
        const who = mate?.name ?? "your Mate";
        return {
          ok: false,
          code: "engine",
          message: `It is in the vault, but ${who} was not told: ${refused}`,
        };
      }
      say(operationKey, "put");
      return outcome;
    },
    [answer, mate?.name, operationKey, projectId, requestId, write],
  );
  const onNotNow = useCallback(() => {
    say(operationKey, "not-now");
    if (requestId === null) return;
    // A decline the engine did not take opens the card again: the Mate was not told.
    void answer("declined").then((refused) => {
      if (refused !== null) unsay(operationKey);
    });
  }, [answer, operationKey, requestId]);
  return (
    <VaultRequestCard
      ask={ask}
      engine={engineState}
      mateName={mate?.name ?? "Your Mate"}
      onNotNow={onNotNow}
      onPut={onPut}
      pickUp={vaultAskPickUp(view, ask)}
      said={said}
      state={vaultAskState(view, ask)}
    />
  );
}
