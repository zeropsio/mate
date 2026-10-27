/**
 * A request for a vault value as a V1 conversation draws it: the ask read off the Mate's
 * `zerops_env action=request` call, its state off its environment's project vault — held while
 * the card is drawn, so it reads with the Vault panel closed — and a put submitted as the panel
 * submits it, as the person, kept for the Mate's next message (`recordVaultWrite`). An ask the
 * engine keeps is the composer's drawer and the asking run's result row, never this card. What
 * the person said here is kept in memory by the call, so a card the list draws again says it
 * still. The value lives in the field and the write, nowhere else.
 */
import { NOT_READ_VAULT, vaultAtom } from "@t3tools/client-runtime/data";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo } from "react";
import { create } from "zustand";

import { useThreadDetail } from "~/state/entities";
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
  vaultAskState,
} from "./vaultRequest.logic";

const UNREAD = Atom.make(NOT_READ_VAULT);

/** What the person said to each ask here, by its operation's key. Memory only. */
const useVaultAskSaid = create<Readonly<Record<string, VaultAskSaid>>>()(() => ({}));

function say(operationKey: string, said: VaultAskSaid): void {
  useVaultAskSaid.setState((state) => ({ ...state, [operationKey]: said }));
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
  // An ask the engine keeps: the drawer asks it, the run's result row says how it ended.
  const kept = useThreadDetail(
    threadRef,
    useMemo(() => engineKeeps(ask), [ask]),
  );
  if (ask === null || environmentId === null || kept) return null;
  return <AskCard ask={ask} environmentId={environmentId} operationKey={operation.key} />;
}

const engineKeeps =
  (ask: VaultAsk | null) =>
  (detail: { readonly activities?: unknown } | null): boolean =>
    ask !== null &&
    engineVaultAskFor(detail?.activities as Parameters<typeof engineVaultAskFor>[0], ask) !== null;

function AskCard({
  ask,
  environmentId,
  operationKey,
}: {
  readonly ask: VaultAsk;
  readonly environmentId: EnvironmentId;
  readonly operationKey: string;
}) {
  const project = useZeropsEnvironmentProject(environmentId);
  const mate = useKnownMate(environmentId);
  const projectId = project?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const view = useAtomValue(projectId === null ? UNREAD : vaultAtom(projectId));
  const said = useVaultAskSaid((state) => state[operationKey] ?? null);
  const { write } = useVaultWriter(project, view);
  const onPut = useCallback<VaultRequestCardProps["onPut"]>(
    async (scope, vaultWrite) => {
      const { outcome, change } = await write(scope, vaultWrite);
      if (change !== null && projectId !== null) {
        recordVaultWrite(projectId, change);
        say(operationKey, "put");
      }
      return outcome;
    },
    [operationKey, projectId, write],
  );
  const onNotNow = useCallback(() => say(operationKey, "not-now"), [operationKey]);
  return (
    <VaultRequestCard
      ask={ask}
      mateName={mate?.name ?? "Your Mate"}
      onNotNow={onNotNow}
      onPut={onPut}
      said={said}
      state={vaultAskState(view, ask)}
    />
  );
}
