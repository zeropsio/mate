/**
 * A value the Mate asked the person for, in both its homes: the card in the conversation where
 * the Mate's `zerops_env action=request` call stands, and the same ask above the composer while
 * the Mate is stopped on it. Both read the engine's record of the ask (open, saved, declined: who
 * and when) and its project's vault, held while a card is drawn so it reads with the Vault panel
 * closed. Save to vault writes the value as the person's vault write, then answers the ask saved
 * (only the outcome reaches the engine); Not now answers it declined. A secret asked for in the
 * application's stage or production (`zerops_propose_env secret=true`) is the same ask in that
 * project, its vault read and written with the person's own access there. Either way the running
 * services that read the value are restarted through their own restart before the engine hears
 * saved. Nothing the person
 * said is kept here: a press under way and its refusal are the only things this tab holds.
 */
import {
  NOT_READ_VAULT,
  type VaultAskActivityPayload,
  type VaultScopeRef,
  type VaultView,
  projectOperator,
  vaultAtom,
  vaultRestarts,
} from "@t3tools/client-runtime/data";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useServerConfigs, useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";
import { usePersonNames } from "~/zerops/useZeropsMateOwners";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { showAskInConversation } from "../../ask/askReveal";
import type { AskDensity } from "../../ask/AskCard";
import { ComposerAskFace } from "../../chat/ComposerAsk";
import { useVaultWriter } from "./VaultPanelContainer";
import { type NotRestarted, restartInTurn } from "./readerRestarts";
import { VaultAsk } from "./VaultAsk";
import {
  type VaultAsk as VaultAskModel,
  type VaultAskPress,
  engineVaultAskFor,
  openVaultAsk,
  vaultAskLabel,
  vaultAskOf,
  vaultAskRowHolds,
  vaultAskState,
  vaultAskView,
} from "./vaultRequest.logic";

const UNREAD = Atom.make(NOT_READ_VAULT);
const UNDECIDED = Atom.make<boolean | undefined>(undefined);

/**
 * The answer's word on readers a reload left unrestarted, within the contract: the first by its
 * hostname, the rest in the reason.
 */
function notRestartedYet(
  services: ReadonlyArray<{ readonly hostname: string }>,
): NotRestarted | undefined {
  const [first, ...rest] = services.map((service) => service.hostname);
  if (first === undefined) return undefined;
  const reason =
    rest.length === 0 ? "not restarted yet" : `not restarted yet, nor ${rest.join(", ")}`;
  return { hostname: first.slice(0, 64), reason: reason.slice(0, 280) };
}

/** Where the asked value goes in the vault it reads: Shared, or its service's own. */
function askScopeRef(view: VaultView, ask: VaultAskModel): VaultScopeRef | null {
  if (ask.scope.kind === "shared") return { kind: "shared" };
  const hostname = ask.scope.hostname;
  return view.scopes.find((scope) => scope.hostname === hostname)?.ref ?? null;
}

type Activities = Parameters<typeof engineVaultAskFor>[0];
const activitiesOf = (detail: { readonly activities?: unknown } | null): Activities =>
  detail?.activities as Activities;

/** The ask a home draws: the engine's request and record, and the ask as the card words it. */
interface RecordedAsk {
  readonly requestId: string;
  readonly ask: VaultAskModel;
  readonly record: Pick<VaultAskActivityPayload, "state" | "answer">;
}

/**
 * The card where the Mate asked, for an operation that asks for a value. Without the engine's
 * record of it (a conversation from before the engine recorded asks), the operation reads as it
 * did: `fallback`. Until the conversation is read, neither shows.
 */
export function VaultRequestCardContainer({
  operation,
  environmentId,
  threadRef,
  fallback,
}: {
  readonly operation: ZeropsOperation;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly fallback: ReactNode;
}) {
  const ask = useMemo(() => vaultAskOf(operation), [operation]);
  // `undefined` until the conversation is read: whether the engine holds a record is not known.
  const record = useThreadDetail(
    threadRef,
    useCallback(
      (detail: { readonly activities?: unknown } | null) =>
        detail === null
          ? undefined
          : ask === null
            ? null
            : engineVaultAskFor(activitiesOf(detail), ask),
      [ask],
    ),
  );
  // Neither card is drawn before it is known which one stands: the operation's holds the room unseen.
  if (record === undefined && threadRef !== null)
    return fallback === null ? null : (
      <div aria-hidden="true" className="invisible" inert>
        {fallback}
      </div>
    );
  if (
    ask === null ||
    record === null ||
    record === undefined ||
    environmentId === null ||
    threadRef === null
  )
    return fallback;
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

/**
 * The same open request for a surface outside the conversation (its header's status): what it asks
 * for, in people's words, and the way to its card's row.
 */
export function useOpenVaultAskDoor(
  threadRef: ScopedThreadRef | null,
): { readonly name: string; readonly show: () => void } | null {
  const open = useThreadDetail(threadRef, selectOpenAsk);
  return useMemo(
    () =>
      open === null
        ? null
        : {
            name: vaultAskLabel(open.ask),
            show: () =>
              showAskInConversation({
                askId: open.requestId,
                holds: vaultAskRowHolds(open.ask),
              }),
          },
    [open],
  );
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
  const { requestId, record } = asked;
  const home = useZeropsEnvironmentProject(environmentId);
  // The vault the value goes to: the Mate's own, or its application's stage or production.
  const elsewhere = asked.ask.environment;
  const project = useMemo(
    () =>
      home === undefined || elsewhere === undefined
        ? home
        : { orgId: home.orgId, projectId: elsewhere.projectId },
    [home, elsewhere],
  );
  const mate = useKnownMate(environmentId);
  const mateName = mate?.name ?? "This Mate";
  const projectId = project?.projectId ?? null;
  useDetailDemand("projectVariables", undefined, projectId);
  useDetailDemand("serviceVariable", undefined, projectId);
  useDetailDemand("process", "history", projectId);
  const view = useAtomValue(projectId === null ? UNREAD : vaultAtom(projectId));
  const { run, write } = useVaultWriter(project, view);
  // A server that takes what the card restarted on the answer: only then does a card in the
  // Mate's own project restart (an older Mate's agent restarts them, as zcp tells it there).
  const takesRestarts =
    useServerConfigs().get(environmentId)?.environment.capabilities.vaultAnswerRestarts === true;
  const restarts = elsewhere !== undefined || takesRestarts;
  // The running services that read the value, restarted once it is saved: those zcp named for
  // stage or production and those the vault's references say read it, once each — in the Mate's
  // own project only those whose entries reference it, since a restart stops its dev servers. A
  // value given since it was asked restarts only the readers that do not run it yet: the Vault
  // panel's save may have restarted them already.
  const askedFor = asked.ask;
  const { ask, running } = useMemo((): {
    readonly ask: VaultAskModel;
    readonly running: ReadonlyArray<string>;
  } => {
    const { restart: _named, ...rest } = askedFor;
    const ref = askScopeRef(view, askedFor);
    if (!restarts || view.status === "unread" || ref === null) return { ask: rest, running: [] };
    const plan = vaultRestarts(
      view,
      [{ scope: ref, write: { kind: "add", key: askedFor.key, value: "", sensitive: false } }],
      askedFor.restart ?? [],
      { byName: elsewhere !== undefined },
    );
    const state = vaultAskState(view, askedFor);
    const live = (serviceId: string) =>
      state.kind === "filled" &&
      state.held.readers.some(
        (reader) => reader.serviceId === serviceId && reader.state === "live",
      );
    const restart = plan.restart.filter((service) => !live(service.serviceId));
    return {
      ask: restart.length === 0 ? rest : { ...rest, restart },
      running: plan.restart
        .filter((service) => live(service.serviceId))
        .map((service) => service.hostname),
    };
  }, [askedFor, elsewhere, restarts, view]);
  // The services this card restarted, told with saved.
  const restartedHere = useRef<ReadonlyArray<string>>([]);
  // Stage or production is given only by someone who can change it.
  const operates = useProjection(
    projectOperator,
    elsewhere === undefined ? null : (project ?? null),
    UNDECIDED,
  );
  const readOnly =
    elsewhere !== undefined && operates === false
      ? `Only someone who can change ${elsewhere.name} can add it.`
      : null;
  const nameOf = usePersonNames(project?.orgId);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const answerVaultAsk = useAtomCommand(threadEnvironment.answerVaultAsk, {
    reportFailure: false,
  });
  const [pending, setPending] = useState<VaultAskPress | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A stage or production service that did not restart after the save: the card can finish without it.
  const [unrestarted, setUnrestarted] = useState<NotRestarted | null>(null);

  /**
   * Tells the engine how the ask ended; `null` once it took it, else why not. The press stays
   * under way until the record says so (`vaultAskView` reads the record first). A secret saved in
   * stage or production names the project it went to, which the engine checks against the ask.
   */
  const answer = useCallback(
    async (outcome: "saved" | "declined", notRestarted?: NotRestarted): Promise<string | null> => {
      const result = await answerVaultAsk({
        environmentId,
        input: {
          threadId: threadRef.threadId,
          requestId,
          outcome,
          ...(elsewhere === undefined || outcome !== "saved"
            ? {}
            : { projectId: elsewhere.projectId }),
          ...(notRestarted === undefined ? {} : { notRestarted }),
          ...(outcome === "saved" && takesRestarts
            ? { restarted: [...new Set([...restartedHere.current, ...running])] }
            : {}),
        },
      });
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
      const error = squashAtomCommandFailure(result);
      return error instanceof Error ? error.message : `${mateName} did not take the answer.`;
    },
    [
      answerVaultAsk,
      elsewhere,
      environmentId,
      mateName,
      requestId,
      running,
      takesRestarts,
      threadRef.threadId,
    ],
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
  /**
   * Restarts the running services that read the value, one after another, so they run it; `null`
   * once all did, else which did not and why.
   */
  const restartReaders = useCallback(async (): Promise<NotRestarted | null> => {
    const restart = ask.restart ?? [];
    if (project === undefined || restart.length === 0) return null;
    setPending("restart");
    const { restarted, failed } = await restartInTurn(run, project, restart);
    restartedHere.current = [
      ...new Set([...restartedHere.current, ...restarted.map((service) => service.hostname)]),
    ];
    return failed === null ? null : { hostname: failed.hostname, reason: failed.reason };
  }, [ask.restart, project, run]);
  /** The Mate hears saved once the value runs: restarted where it names readers. */
  const savedAndTold = useCallback(async (): Promise<string | null> => {
    setUnrestarted(null);
    const notRestarted = await restartReaders();
    if (notRestarted !== null) {
      setUnrestarted(notRestarted);
      return `It's saved in ${elsewhere?.name ?? "the vault"}, but ${notRestarted.hostname} didn't restart: ${notRestarted.reason}`;
    }
    setPending("useGiven");
    const refused = await answer("saved");
    return refused === null ? null : `It's saved, but ${mateName} wasn't told: ${refused}`;
  }, [answer, elsewhere, mateName, restartReaders]);
  const onSave = useCallback(
    (scope: Parameters<typeof write>[0], vaultWrite: Parameters<typeof write>[1]) =>
      press("save", async () => {
        const { outcome } = await write(scope, vaultWrite);
        if (!outcome.ok) return outcome.message ?? "Zerops did not take it.";
        return savedAndTold();
      }),
    [press, savedAndTold, write],
  );
  const onUseGiven = useCallback(() => void press("useGiven", savedAndTold), [press, savedAndTold]);
  const vault = vaultAskState(view, ask);
  // Saved but not restarted (a restart failed, or a reload since the save): finishing says so —
  // never declined, for the value is there.
  const savedUnrestarted = vault.kind === "filled" && (ask.restart ?? []).length > 0;
  const finishUnrestarted = useCallback(
    () =>
      void press("notNow", () =>
        answer("saved", unrestarted ?? notRestartedYet(ask.restart ?? [])),
      ),
    [answer, ask.restart, press, unrestarted],
  );
  const onNotNow = useCallback(
    () => (savedUnrestarted ? finishUnrestarted() : void press("notNow", () => answer("declined"))),
    [answer, finishUnrestarted, press, savedUnrestarted],
  );
  const onShowInConversation = useCallback(
    () => showAskInConversation({ askId: requestId, holds: vaultAskRowHolds(ask) }),
    [ask, requestId],
  );

  return (
    <VaultAsk
      ask={ask}
      askId={requestId}
      density={density}
      face={density === "compact" ? <ComposerAskFace environmentId={environmentId} /> : undefined}
      mateName={mateName}
      onFinishUnrestarted={unrestarted === null ? undefined : finishUnrestarted}
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
        readOnly,
      })}
    />
  );
}
