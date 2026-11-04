/**
 * A value the Mate asked the person for, in both its homes: the card in the conversation where
 * the Mate's `zerops_env action=request` call stands, and the same ask above the composer while
 * the Mate is stopped on it. Both read the engine's record of the ask (open, saved, declined: who
 * and when) and its project's vault, held while a card is drawn so it reads with the Vault panel
 * closed. Save to vault writes the value as the person's vault write, then answers the ask saved
 * (only the outcome reaches the engine); Not now answers it declined. Nothing the person said is
 * kept here: a press under way and its refusal are the only things this tab holds.
 */
import {
  NOT_READ_VAULT,
  type VaultAskActivityPayload,
  vaultAtom,
} from "@t3tools/client-runtime/data";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useDetailDemand } from "~/zerops/ZeropsAccountData";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { showAskInConversation } from "../../ask/askReveal";
import type { AskDensity } from "../../ask/AskCard";
import { ComposerAskFace } from "../../chat/ComposerAsk";
import { useVaultWriter } from "./VaultPanelContainer";
import { VaultAsk } from "./VaultAsk";
import {
  type VaultAsk as VaultAskModel,
  type VaultAskPress,
  engineVaultAskFor,
  openVaultAsk,
  vaultAskOf,
  vaultAskRowHolds,
  vaultAskState,
  vaultAskView,
} from "./vaultRequest.logic";

const UNREAD = Atom.make(NOT_READ_VAULT);

type Activities = Parameters<typeof engineVaultAskFor>[0];
const activitiesOf = (detail: { readonly activities?: unknown } | null): Activities =>
  detail?.activities as Activities;

/** The ask a home draws: the engine's request and record, and the ask as the card words it. */
interface RecordedAsk {
  readonly requestId: string;
  readonly ask: VaultAskModel;
  readonly record: Pick<VaultAskActivityPayload, "state" | "answer">;
}

/** The card where the Mate asked, for an operation that asks for a value; nothing for another. */
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
  const record = useThreadDetail(
    threadRef,
    useCallback(
      (detail: { readonly activities?: unknown } | null) =>
        ask === null ? null : engineVaultAskFor(activitiesOf(detail), ask),
      [ask],
    ),
  );
  if (ask === null || record === null || environmentId === null || threadRef === null) return null;
  return (
    <VaultAskHome
      asked={{ requestId: record.requestId, ask, record }}
      density="full"
      environmentId={environmentId}
      threadRef={threadRef}
    />
  );
}

const selectOpenAsk = (detail: { readonly activities?: unknown } | null) =>
  openVaultAsk(activitiesOf(detail));
const selectOpenId = (detail: { readonly activities?: unknown } | null) =>
  selectOpenAsk(detail)?.requestId ?? null;

/** The request the engine keeps open longest in the conversation: the one above the composer. */
export function useOpenVaultAskId(threadRef: ScopedThreadRef | null): string | null {
  return useThreadDetail(threadRef, selectOpenId);
}

/** The oldest open ask above the composer, with "Show in conversation" to its card. */
export function ComposerVaultAskContainer({
  threadRef,
  environmentId,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
}) {
  const open = useThreadDetail(threadRef, selectOpenAsk);
  if (open === null) return null;
  return (
    <VaultAskHome
      asked={{ ...open, record: { state: "open", answer: null } }}
      density="compact"
      environmentId={environmentId}
      key={open.requestId}
      threadRef={threadRef}
    />
  );
}

function VaultAskHome({
  asked,
  density,
  environmentId,
  threadRef,
}: {
  readonly asked: RecordedAsk;
  readonly density: AskDensity;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const { requestId, ask, record } = asked;
  const project = useZeropsEnvironmentProject(environmentId);
  const mate = useKnownMate(environmentId);
  const mateName = mate?.name ?? "This Mate";
  const projectId = project?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const view = useAtomValue(projectId === null ? UNREAD : vaultAtom(projectId));
  const { write } = useVaultWriter(project, view);
  const nameOf = usePersonNames(project?.orgId);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const answerVaultAsk = useAtomCommand(threadEnvironment.answerVaultAsk, {
    reportFailure: false,
  });
  const [pending, setPending] = useState<VaultAskPress | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  /**
   * Tells the engine how the ask ended; `null` once it took it, else why not. The press stays
   * under way until the record says so (`vaultAskView` reads the record first).
   */
  const answer = useCallback(
    async (outcome: "saved" | "declined"): Promise<string | null> => {
      const result = await answerVaultAsk({
        environmentId,
        input: { threadId: threadRef.threadId, requestId, outcome },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
      const error = squashAtomCommandFailure(result);
      return error instanceof Error ? error.message : `${mateName} did not take the answer.`;
    },
    [answerVaultAsk, environmentId, mateName, requestId, threadRef.threadId],
  );
  const press = useCallback(
    async (kind: VaultAskPress, run: () => Promise<string | null>): Promise<boolean> => {
      setPending(kind);
      setRefusal(null);
      const refused = await run();
      if (refused === null) return true;
      setPending(null);
      setRefusal(refused);
      return false;
    },
    [],
  );
  const onSave = useCallback(
    (scope: Parameters<typeof write>[0], vaultWrite: Parameters<typeof write>[1]) =>
      press("save", async () => {
        const { outcome } = await write(scope, vaultWrite);
        if (!outcome.ok) return outcome.message ?? "Zerops did not take it.";
        const refused = await answer("saved");
        return refused === null
          ? null
          : `It's in the vault, but ${mateName} wasn't told: ${refused}`;
      }),
    [answer, mateName, press, write],
  );
  const onUseGiven = useCallback(
    () => void press("useGiven", () => answer("saved")),
    [answer, press],
  );
  const onNotNow = useCallback(
    () => void press("notNow", () => answer("declined")),
    [answer, press],
  );
  const onShowInConversation = useCallback(
    () => showAskInConversation({ askId: requestId, holds: vaultAskRowHolds(ask) }),
    [ask, requestId],
  );

  const vault = vaultAskState(view, ask);
  return (
    <VaultAsk
      ask={ask}
      askId={requestId}
      density={density}
      face={density === "compact" ? <ComposerAskFace environmentId={environmentId} /> : undefined}
      mateName={mateName}
      onNotNow={onNotNow}
      onSave={onSave}
      onShowInConversation={density === "compact" ? onShowInConversation : undefined}
      onUseGiven={onUseGiven}
      vault={vault}
      view={vaultAskView({
        ask,
        mateName,
        record,
        vault,
        pending,
        refusal,
        nameOf,
        clock: (at) => formatDayAwareTimestamp(new Date(at).toISOString(), timestampFormat),
      })}
    />
  );
}
