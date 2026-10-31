/**
 * The Zerops feeds as one layer, so the server's runtime composition takes a
 * single line for both.
 *
 * The lifecycle and authorization feeds are independent by design, so a
 * failure in one never blanks the other. `ZeropsAgentLogin` is the one
 * exception: it calls `ZeropsAgentAuth.recheckNow` on a login success, so its
 * layer retains the authorization service it receives. `ws.ts` and the login
 * module therefore share the SAME `ZeropsAgentAuth` instance. `ZeropsSignOut`
 * shares that same instance too, plus the same `ZeropsAgentLogin` instance —
 * see its own branch below for why. The logins beyond the defaults
 * (`ZeropsLogins`) are one instance the same way: the login walker re-checks
 * them, their sign-out cancels its sessions, and the turn gate reads them.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { CommandId, ConversationId, ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import { SessionAdmission } from "../auth/EnvironmentAuthPolicy.ts";
import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import { layer as providerInstancesLayer } from "../spi/providerInstances.ts";
import * as ProcessRunner from "../processRunner.ts";
import { conversationOfThread, MateEngine } from "../engine/MateEngine.ts";
import { engineLayer } from "../engine/layer.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { CrewEngine } from "./crew/CrewEngine.ts";
import { crewEngineHooks, crewLayer } from "./crew/crewLayer.ts";
import { crewEngineLinkLayer } from "./crew/engine/CrewEngineLayer.ts";
import { CrewPlatformProcesses } from "./crew/crewDeployState.ts";
import { engineAdaptersLayer } from "./engineAdapters.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentFlagModule from "./ZeropsAgentFlag.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsAutomationModule from "./ZeropsAutomation.ts";
import * as ZeropsBrowserStreamModule from "./ZeropsBrowserStream.ts";
import * as ZeropsMacStreamModule from "./ZeropsMacStream.ts";
import * as ZeropsHqLinkModule from "./ZeropsHqLink.ts";
import * as ZeropsCliModule from "./ZeropsCli.ts";
import * as ZeropsDataConsoleModule from "./ZeropsDataConsole.ts";
import * as ZeropsGitRemoteProbeModule from "./ZeropsGitRemoteProbe.ts";
import { loadFixtureScene, makeFixtureZeropsLayer } from "./ZeropsFixtureFeeds.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import { ZEROPS_WORKSPACE_ROOT } from "./ZeropsRepositorySource.ts";
import * as ZeropsLoginsModule from "./ZeropsLogins.ts";
import * as ZeropsMateAttentionModule from "./ZeropsMateAttention.ts";
import * as ZeropsGitCredentialFileModule from "./ZeropsGitCredentialFile.ts";
import * as ZeropsObserveCredentialFileModule from "./ZeropsObserveCredentialFile.ts";
import * as ZeropsMateAccessListModule from "./ZeropsMateAccessList.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { mateAutoUpdatePolicyLayer } from "./MateAutoUpdatePolicy.ts";
import * as ZeropsMateUpdateModule from "./ZeropsMateUpdate.ts";
import { zeropsUserIdOf } from "./zeropsSubject.ts";
import * as ZeropsConnectionsModule from "./ZeropsConnections.ts";
import * as ZeropsTicketDoorModule from "./ZeropsTicketDoor.ts";
import * as ZeropsOffboardingModule from "./ZeropsOffboarding.ts";
import * as ZeropsRestartReadModule from "./ZeropsRestartRead.ts";
import * as ZeropsOrgReadModule from "./ZeropsOrgRead.ts";
import * as ZeropsProjectSignersModule from "./ZeropsProjectSigners.ts";
import * as ZeropsSetupModule from "./ZeropsSetup.ts";
import * as ZeropsSignInsModule from "./zeropsSignIns.ts";
import * as ZeropsSignOutModule from "./ZeropsSignOut.ts";
import * as ZeropsStandUpRelayModule from "./ZeropsStandUpRelay.ts";
import * as ZeropsStandUpReceiptModule from "./ZeropsStandUpReceipt.ts";
import * as ZeropsCommitAuthorModule from "./ZeropsCommitAuthor.ts";
import * as ZeropsWorkingCopyModule from "./ZeropsWorkingCopy.ts";
import * as ZeropsTaskLedgerModule from "./ZeropsTaskLedger.ts";
import * as ZeropsTasksModule from "./ZeropsTasks.ts";
import * as ZeropsTurnAdmissionModule from "./ZeropsTurnAdmission.ts";
import * as ZeropsWorkflowTools from "./ZeropsWorkflowTools.ts";
import * as ZeropsCrewProposalsModule from "./ZeropsCrewProposals.ts";

/**
 * One access list for the auth boundary, the door, the watch and the link to HQ, with the own-key
 * reader the door still reads Zerops with.
 */
export const ZeropsMateAccessListLive = ZeropsMateAccessListModule.layer.pipe(
  Layer.provideMerge(ZeropsOrgReadModule.layer),
  Layer.provideMerge(ZeropsMateKeyModule.layer),
);

/** One connection registry shared by the HQ link, WebSocket and HTTP transports. */
export const ZeropsConnectionsLive = ZeropsConnectionsModule.layer.pipe(
  Layer.provideMerge(ZeropsTicketDoorModule.layer),
  Layer.provideMerge(ZeropsMateAccessListLive),
);

/** Existing credentials must still belong here before they expose any protected response. */
export const ZeropsSessionAdmissionLive = Layer.effect(
  SessionAdmission,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const access = yield* ZeropsMateAccessListModule.ZeropsMateAccessList;
    return (subject: string) =>
      config.zerops === undefined || config.zeropsFixtures !== undefined
        ? Effect.succeed(true)
        : access.current.pipe(
            Effect.map((current) =>
              Option.match(current, {
                onNone: () => false,
                onSome: (list) =>
                  !list.refused &&
                  list.members.some(
                    (member) =>
                      member.userId === zeropsUserIdOf(subject) && member.visibility === "open",
                  ),
              }),
            ),
          );
  }),
);

/**
 * `ZeropsAgentAuth.layer` reaches the provider registry only through
 * `ProviderInstances` (`spi/providerInstances.ts`), discharged here so
 * `ProviderRegistry` bubbles up to the one shared instance `server.ts`
 * provides everywhere else — never a second registry.
 */
const ZeropsAgentAuthLive = ZeropsAgentAuth.layer.pipe(Layer.provide(providerInstancesLayer));

/** The same `ProviderInstances` discharge, for the logins' picker reconcile. */
const ZeropsLoginsLive = ZeropsLoginsModule.layer.pipe(Layer.provide(providerInstancesLayer));

/**
 * D6's one gate, over the same agent-auth and signers instances the branches
 * below build (memoized by reference): ws.ts and the HTTP dispatch route
 * admit every turn through it, and so does the crew engine.
 */
const ZeropsTurnAdmissionLive = ZeropsTurnAdmissionModule.layer.pipe(
  Layer.provide(ZeropsAgentLoginModule.layer),
  Layer.provide(ZeropsAgentAuthLive),
  Layer.provide(ZeropsLoginsLive),
  Layer.provide(ZeropsProjectSignersModule.layer),
  Layer.provide(providerInstancesLayer),
);

/**
 * Crew mode (`zerops/crew`, reached only from here and ws.ts): inert unless this is a Zerops
 * project with T3CODE_ZEROPS_CREW on, and even then it opens no ssh and installs no thread policy
 * until a crew is applied. It admits its turns through the same gate instance. One value, so the
 * link below reads the very engine the merge runs.
 */
/** Crew's port to the platform's process list: whether a deploy a restart cut off still runs. */
const CrewPlatformProcessesLive = Layer.effect(
  CrewPlatformProcesses,
  Effect.map(ZeropsRestartReadModule.ZeropsRestartRead, (reader) =>
    CrewPlatformProcesses.of({
      read: reader.read.pipe(
        Effect.map((evidence) => evidence.processes),
        Effect.orElseSucceed(() => undefined),
      ),
    }),
  ),
).pipe(Layer.provide(ZeropsRestartReadModule.layer));

/**
 * What the Mate engine runs for the crew (engine crew mode only): the crew's owner kind, its
 * effects' handlers and its crewmates' workspaces, over the same crew services and the same link
 * the crew's front completes (memoized by reference).
 */
const CrewEngineHooksLive = crewEngineHooks.pipe(
  Layer.provide(crewEngineLinkLayer),
  Layer.provide(CrewPlatformProcessesLive),
  Layer.provide(providerInstancesLayer),
  Layer.provide(ProcessRunner.layer),
);

/**
 * The Mate engine (`engine/`, reached only from here, ws.ts and the startup). Its ports are
 * Zerops's: runs are admitted through the same gate
 * instance and the restart is read by the same own-key reader (memoized by reference). One value,
 * so the sign-out below stops sessions on the very engine the merge runs, and the crew's front
 * runs on it.
 */
const MateEngineLive = engineLayer.pipe(
  Layer.provideMerge(
    engineAdaptersLayer.pipe(
      Layer.provide(ZeropsTurnAdmissionLive),
      Layer.provide(ZeropsRestartReadModule.layer),
      Layer.provide(ZeropsCliModule.layer),
    ),
  ),
  Layer.provide(CrewEngineHooksLive),
);

const ZeropsCrewLive = crewLayer.pipe(
  Layer.provide(MateEngineLive),
  Layer.provide(crewEngineLinkLayer),
  Layer.provide(CrewPlatformProcessesLive),
  Layer.provide(ZeropsTurnAdmissionLive),
  Layer.provide(ZeropsAgentAuthLive),
  Layer.provide(ZeropsLoginsLive),
  Layer.provide(ZeropsProjectSignersModule.layer),
  Layer.provide(providerInstancesLayer),
  Layer.provide(ProcessRunner.layer),
);

/**
 * The Mate's attention, one instance for the link and the Mate's own clients (memoized by
 * reference): the engine's conversations.
 */
const ZeropsMateAttentionLive = ZeropsMateAttentionModule.layer.pipe(Layer.provide(MateEngineLive));

/**
 * The Mate's update line (spec-mate §2.9): read by the descriptor and followed by the link. Its
 * restart drains the same owners zcp's drain route reads: the crew and the agent logins are the
 * instances the branches below build (memoized by reference).
 */
const ZeropsMateUpdateLive = ZeropsMateUpdateModule.layer.pipe(
  Layer.provide(MateEngineLive),
  Layer.provide(mateAutoUpdatePolicyLayer),
  Layer.provide(ZeropsCrewLive),
  Layer.provide(ZeropsAgentLoginModule.layer),
  Layer.provide(ZeropsAgentAuthLive),
  Layer.provide(ZeropsLoginsLive),
  Layer.provide(ZeropsProjectSignersModule.layer),
  Layer.provide(providerInstancesLayer),
  Layer.provideMerge(ZeropsCliModule.layer),
);

/**
 * The Mate's one link to its HQ (SPEC §3.4): its overview up — its chats, its logins as the
 * agent-auth feed reads them, its crew and its update line, each the same instance the merge below
 * runs, memoized by reference — beside it its attention, and its state down. The setup reads the state it brings. The crew
 * engine is handed to it here, so only this wiring reaches into `zerops/crew`.
 */
const ZeropsHqLinkLive = Layer.unwrap(
  Effect.gen(function* () {
    return ZeropsHqLinkModule.layer(yield* CrewEngine);
  }),
).pipe(
  Layer.provide(mateAutoUpdatePolicyLayer),
  Layer.provide(ZeropsCrewLive),
  Layer.provide(providerInstancesLayer),
  Layer.provide(ZeropsAgentLoginModule.layer),
  Layer.provide(ZeropsAgentAuthLive),
  Layer.provide(ZeropsLoginsLive),
  Layer.provide(ZeropsProjectSignersModule.layer),
  Layer.provide(ZeropsMateUpdateLive),
  Layer.provide(ZeropsMateAttentionLive),
  // The tasks HQ hands an automated Mate, worked on the very engine the merge runs.
  Layer.provide(
    ZeropsTasksModule.layer.pipe(
      Layer.provide(providerInstancesLayer),
      Layer.provide(ZeropsTaskLedgerModule.layer),
      Layer.provide(ZeropsCommitAuthorModule.layer),
      Layer.provide(ZeropsWorkingCopyModule.layer),
    ),
  ),
  Layer.provide(MateEngineLive),
);

/**
 * The lifecycle feed, which tells a conversation's own record the lease its agent acquired, and
 * every conversation bound to a lease that ended, through the very engine the merge runs (memoized
 * by reference): the record binds or unbinds it, under the call's own command id, so a call told
 * again acts once. Who is bound is read from the conversations' records (their lease alone, never
 * their views), only when a call says something new of the leases; a record that could not be read
 * is read again with the next call that reads them. A lease that changed hands has its checkout's
 * git status forgotten and read again: the same alias may be another branch's container now.
 */
const ZeropsLifecycleLive = Layer.unwrap(
  Effect.gen(function* () {
    const engine = yield* MateEngine;
    const vcsStatus = yield* VcsStatusBroadcaster;
    return ZeropsLifecycle.layer(conversationOfThread, {
      checkoutChanged: (alias) => vcsStatus.forgetStatus(`${ZEROPS_WORKSPACE_ROOT}/${alias}`),
      // A conversation whose record could not be read leaves the list incomplete, never unbound.
      leaseBindings: Effect.map(engine.leases, ({ leases, complete }) => ({
        bindings: leases.map(({ conversationId, lease }) => ({
          conversation: ThreadId.make(conversationId),
          alias: lease.alias,
          branch: lease.branch,
          repo: lease.repo,
          acquiredAt: lease.acquiredAt,
        })),
        complete,
      })),
      recordLease: (conversation, change, key) =>
        engine
          .deliver(ConversationId.make(conversation), change, CommandId.make(key), {
            kind: "engine",
          })
          .pipe(
            Effect.flatMap((result) =>
              result._tag === "Rejected"
                ? Effect.logWarning("A conversation's record refused its lease change", {
                    conversation,
                    change: change._tag,
                    rejection: result.rejection,
                  })
                : Effect.void,
            ),
            Effect.catch((error) =>
              Effect.logWarning("A conversation's lease change could not be recorded", {
                conversation,
                change: change._tag,
                error: error.message,
              }),
            ),
          ),
    });
  }),
).pipe(Layer.provide(ZeropsThreadLifecycle.layer), Layer.provide(MateEngineLive));

const liveLayer = Layer.mergeAll(
  ZeropsLifecycleLive,
  // `ZeropsProjectSigners` is merged rather than hidden: the agent-auth feed
  // reads who signed each agent in for its snapshot, and the turn gate below
  // asks the same service before it lets a turn start (D6). Both go by the
  // one store of sign-ins provided at the bottom.
  ZeropsAgentLoginModule.layer.pipe(
    Layer.provideMerge(ZeropsAgentAuthLive),
    Layer.provideMerge(ZeropsLoginsLive),
    Layer.provideMerge(ZeropsProjectSignersModule.layer),
  ),
  // The one sign-out (`ZeropsSignOut`) declares `ZeropsAgentLogin`/`ZeropsAgentAuth`/
  // `ZeropsLogins` as REQUIREMENTS it locally `Layer.provide`s from the SAME
  // `.layer` values referenced above — Effect memoizes a layer by reference
  // across one build, so this is the one running instance of each, not a
  // second copy. A sibling `Layer.mergeAll(...)` branch would NOT do this:
  // layers merged as siblings are built independently against the ambient
  // context and never see each other's output, which is what leaked
  // `ZeropsAgentLogin` as an unmet requirement all the way up to `server.ts`
  // the first time this was tried. Offboarding signs a person this project no
  // longer opens for out of every login, by that same sign-out.
  ZeropsOffboardingModule.layer.pipe(
    Layer.provideMerge(
      ZeropsSignOutModule.layer.pipe(
        Layer.provide(ZeropsAgentLoginModule.layer),
        Layer.provide(ZeropsAgentAuthLive),
        Layer.provide(ZeropsLoginsLive),
        Layer.provide(ZeropsAgentFlagModule.layer),
        Layer.provide(ZeropsProjectSignersModule.layer),
        Layer.provide(MateEngineLive),
      ),
    ),
    Layer.provide(ZeropsProjectSignersModule.layer),
  ),
  ZeropsTurnAdmissionLive,
  ZeropsCrewLive,
  // A crew proposed from the goal, on the Mate's agent, admitted through the same gate.
  ZeropsCrewProposalsModule.layer.pipe(Layer.provide(ZeropsTurnAdmissionLive)),
  MateEngineLive,
  ZeropsWorkflowTools.layer.pipe(
    Layer.provide(MateEngineLive),
    Layer.provide(providerInstancesLayer),
  ),
  // A new Mate's setup, reported at `/setup.json`, and its stand-up started
  // here once its asker has an agent to run — admitted through the same gate.
  // …and a running stand-up's progress, relayed from zcp's status file to its run card.
  ZeropsStandUpRelayModule.layer.pipe(
    Layer.provide(MateEngineLive),
    Layer.provideMerge(
      ZeropsSetupModule.layer.pipe(
        Layer.provide(
          ZeropsSetupModule.liveReadsLayer.pipe(
            Layer.provide(ZeropsHqLinkLive),
            Layer.provide(ZeropsAgentAuthLive),
            Layer.provide(providerInstancesLayer),
            Layer.provide(ZeropsProjectSignersModule.layer),
          ),
        ),
        Layer.provide(ZeropsTurnAdmissionLive),
        Layer.provide(MateEngineLive),
      ),
    ),
  ),
  ZeropsHqLinkLive,
  // The same instance the link reads (memoized by reference), for the Mate's own clients.
  ZeropsMateAttentionLive,
  ZeropsBrowserStreamModule.layer,
  ZeropsMacStreamModule.layer,
  ZeropsMateUpdateLive,
  mateAutoUpdatePolicyLayer,
  ZeropsDataConsoleModule.layer,
  ZeropsGitRemoteProbeModule.layer,
).pipe(
  // Startup's one read of why running turns were interrupted, over the same own-key reader.
  Layer.provideMerge(ZeropsRestartReadModule.layer),
  // Reuse the exact layer the auth boundary reads; a second instance would miss HQ's list.
  Layer.provideMerge(ZeropsConnectionsLive),
  // The Mate's Git credential file: written by the link, read by the setup's git step.
  Layer.provide(ZeropsGitCredentialFileModule.layer),
  Layer.provide(ZeropsObserveCredentialFileModule.layer),
  // Who signed each login in, as this server saw it: one store, written by the login walker
  // and read by the gate, the feeds, the setup and the link to HQ.
  Layer.provide(ZeropsSignInsModule.layer),
  // Whether the Mate is automated, as HQ says over the link: one instance, read by the gate, the
  // logins and the tasks.
  Layer.provideMerge(ZeropsAutomationModule.layer),
  // The setup's wait for the stand-up, settled by the setup and read by the tasks: one instance.
  Layer.provide(ZeropsStandUpReceiptModule.layer),
);

export const selectZeropsFeedsLayer = (selector: string | undefined) =>
  selector === undefined
    ? Effect.succeed({ kind: "live", layer: liveLayer } as const)
    : loadFixtureScene(selector).pipe(
        Effect.map(
          (scene) =>
            ({
              kind: "fixture",
              layer: makeFixtureZeropsLayer(scene),
            }) as const,
        ),
      );

export const ZeropsLayerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return (yield* selectZeropsFeedsLayer(config.zeropsFixtures)).layer;
  }),
).pipe(Layer.provideMerge(mateAutoUpdatePolicyLayer));
