/**
 * A request for a vault value as a conversation draws it: the ask read off the Mate's
 * `zerops_env action=request` call, its state off its environment's project vault — held while
 * the card is drawn, so it reads with the Vault panel closed — and a put submitted as the panel
 * submits it, then kept for the Mate's next message (`recordVaultWrite`). What the person said
 * here is kept in memory by the call, so a card the list draws again says it still.
 */
import { NOT_READ_VAULT, vaultAtom } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo } from "react";
import { create } from "zustand";

import { useDetailDemand } from "~/zerops/ZeropsAccountData";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { recordVaultWrite } from "~/zerops/vaultTurnNotes";
import { useVaultWriter } from "./VaultPanelContainer";
import { VaultRequestCard, type VaultRequestCardProps } from "./VaultRequestCard";
import { type VaultAsk, type VaultAskSaid, vaultAskOf, vaultAskState } from "./vaultRequest.logic";

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
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
}) {
  const ask = useMemo(() => vaultAskOf(operation), [operation]);
  if (ask === null || environmentId === null) return null;
  return <AskCard ask={ask} environmentId={environmentId} operationKey={operation.key} />;
}

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
