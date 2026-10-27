import * as Crypto from "effect/Crypto";
import { Atom } from "effect/reactivity";
import {
  WS_METHODS,
  type EnvironmentId,
  type OrchestrationShellSnapshot,
  type ServerProvider,
} from "@t3tools/contracts";

import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcCommand,
} from "./runtime.ts";
import {
  type ArchiveThreadInput,
  type CreateThreadInput,
  type InterruptThreadTurnInput,
  type RespondToThreadApprovalInput,
  type RespondToThreadUserInputInput,
  type DismissThreadUserInputInput,
  type SetThreadInteractionModeInput,
  type SetThreadRuntimeModeInput,
  type StartThreadTurnInput,
  type StopThreadSessionInput,
  type UnarchiveThreadInput,
  type UpdateThreadMetadataInput,
  stopThreadSession,
} from "../operations/commands.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  engineContinueAfterLimit,
  engineCreateThread,
  engineAnswerOriginAsk,
  engineAnswerVaultAsk,
  engineSetArchived,
  engineSetInteractionMode,
  engineSetRuntimeMode,
  engineUpdateMetadata,
  modelCapabilitiesIn,
  engineDismissUserInput,
  engineInterruptTurn,
  engineRespondToApproval,
  engineRespondToUserInput,
  engineStartTurn,
  viaEngine,
  type OriginAskAnswerInput,
  type VaultAskAnswerInput,
} from "../data/engineCommands.ts";

export type {
  ArchiveThreadInput,
  CreateThreadInput,
  InterruptThreadTurnInput,
  RespondToThreadApprovalInput,
  RespondToThreadUserInputInput,
  DismissThreadUserInputInput,
  SetThreadInteractionModeInput,
  SetThreadRuntimeModeInput,
  StartThreadTurnInput,
  StopThreadSessionInput,
  UnarchiveThreadInput,
  UpdateThreadMetadataInput,
} from "../operations/commands.ts";

export function createThreadEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
  snapshotAtom: (environmentId: EnvironmentId) => Atom.Atom<OrchestrationShellSnapshot | null>,
  options: {
    /** A Mate's providers, so an engine conversation judges a model options change by its defaults. */
    readonly providersAtom?: (
      environmentId: EnvironmentId,
    ) => Atom.Atom<ReadonlyArray<ServerProvider> | null>;
  } = {},
) {
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { threadId: string } }) =>
      JSON.stringify([environmentId, input.threadId]),
  };
  const commands = {
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:create",
      execute: (input: CreateThreadInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineCreateThread(environmentId, input)),
      scheduler,
      concurrency,
    }),
    archive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:archive",
      execute: (input: ArchiveThreadInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineSetArchived(environmentId, input, true)),
      scheduler,
      concurrency,
    }),
    unarchive: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:unarchive",
      execute: (input: UnarchiveThreadInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineSetArchived(environmentId, input, false)),
      scheduler,
      concurrency,
    }),
    updateMetadata: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:update-metadata",
      execute: (input: UpdateThreadMetadataInput, registry, environmentId) =>
        viaEngine(
          registry,
          environmentId,
          engineUpdateMetadata(environmentId, input, (selection) =>
            modelCapabilitiesIn(
              options.providersAtom === undefined
                ? null
                : registry.get(options.providersAtom(environmentId as EnvironmentId)),
              selection,
            ),
          ),
        ),
      scheduler,
      concurrency,
    }),
    setRuntimeMode: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-runtime-mode",
      execute: (input: SetThreadRuntimeModeInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineSetRuntimeMode(environmentId, input)),
      scheduler,
      concurrency,
    }),
    setInteractionMode: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:set-interaction-mode",
      execute: (input: SetThreadInteractionModeInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineSetInteractionMode),
      scheduler,
      concurrency,
    }),
    startTurn: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:start-turn",
      execute: (input: StartThreadTurnInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineStartTurn(environmentId, input)),
      scheduler,
      concurrency,
    }),
    interruptTurn: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:interrupt-turn",
      execute: (input: InterruptThreadTurnInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineInterruptTurn(environmentId, input)),
      scheduler,
      concurrency,
    }),
    /**
     * The usage-limit notice's Continue: the engine tries the provider now.
     */
    continueAfterLimit: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:continue-after-limit",
      execute: (input: { readonly threadId: string }, registry, environmentId) =>
        viaEngine(registry, environmentId, engineContinueAfterLimit(environmentId, input)),
      scheduler,
      concurrency,
    }),
    /**
     * A value the Mate asked the person for, answered on its card: saved (the card wrote it to
     * the vault itself) or declined. Only the outcome travels.
     */
    answerVaultAsk: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:answer-vault-ask",
      execute: (input: VaultAskAnswerInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineAnswerVaultAsk(environmentId, input)),
      scheduler,
      concurrency,
    }),
    /**
     * An origin the Mate asked the person to deliver finished work back to, answered on its card:
     * connected (the card connected it in HQ itself) or declined. Only the outcome travels.
     */
    answerOriginAsk: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:answer-origin-ask",
      execute: (input: OriginAskAnswerInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineAnswerOriginAsk(environmentId, input)),
      scheduler,
      concurrency,
    }),
    respondToApproval: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:respond-to-approval",
      execute: (input: RespondToThreadApprovalInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineRespondToApproval(environmentId, input)),
      scheduler,
      concurrency,
    }),
    respondToUserInput: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:respond-to-user-input",
      execute: (input: RespondToThreadUserInputInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineRespondToUserInput(environmentId, input)),
      scheduler,
      concurrency,
    }),
    dismissUserInput: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:dismiss-user-input",
      execute: (input: DismissThreadUserInputInput, registry, environmentId) =>
        viaEngine(registry, environmentId, engineDismissUserInput(environmentId, input)),
      scheduler,
      concurrency,
    }),
    stopSession: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:thread:stop-session",
      execute: (input: StopThreadSessionInput) => stopThreadSession(input),
      scheduler,
      concurrency,
    }),
    uploadFeedback: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:commands:thread:upload-feedback",
      tag: WS_METHODS.providerUploadFeedback,
      scheduler,
      concurrency,
    }),
  };
  return { ...commands, snapshotAtom };
}
