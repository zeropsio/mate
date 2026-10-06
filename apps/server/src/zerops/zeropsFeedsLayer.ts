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

import { ServerConfig } from "../config.ts";
import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import { layer as providerInstancesLayer } from "../spi/providerInstances.ts";
import * as ProcessRunner from "../processRunner.ts";
import { CrewEngine } from "./crew/CrewEngine.ts";
import { crewLayer } from "./crew/crewLayer.ts";
import { CrewPlatformProcesses } from "./crew/crewDeployState.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentFlagModule from "./ZeropsAgentFlag.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsBrowserStreamModule from "./ZeropsBrowserStream.ts";
import * as ZeropsHqLinkModule from "./ZeropsHqLink.ts";
import * as ZeropsCliModule from "./ZeropsCli.ts";
import * as ZeropsDataConsoleModule from "./ZeropsDataConsole.ts";
import * as ZeropsGitRemoteProbeModule from "./ZeropsGitRemoteProbe.ts";
import { loadFixtureScene, makeFixtureZeropsLayer } from "./ZeropsFixtureFeeds.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsLoginsModule from "./ZeropsLogins.ts";
import * as ZeropsMateAttentionModule from "./ZeropsMateAttention.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import * as ZeropsMateUpdateModule from "./ZeropsMateUpdate.ts";
import * as ZeropsMembershipWatchModule from "./ZeropsMembershipWatch.ts";
import * as ZeropsOffboardingModule from "./ZeropsOffboarding.ts";
import * as ZeropsRestartReadModule from "./ZeropsRestartRead.ts";
import * as ZeropsOrgReadModule from "./ZeropsOrgRead.ts";
import * as ZeropsProjectAccessModule from "./ZeropsProjectAccess.ts";
import * as ZeropsProjectSignersModule from "./ZeropsProjectSigners.ts";
import * as ZeropsSetupModule from "./ZeropsSetup.ts";
import * as ZeropsSignInsModule from "./zeropsSignIns.ts";
import * as ZeropsSignOutModule from "./ZeropsSignOut.ts";
import * as ZeropsStandUpRelayModule from "./ZeropsStandUpRelay.ts";
import * as ZeropsTurnAdmissionModule from "./ZeropsTurnAdmission.ts";

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

const ZeropsCrewLive = crewLayer.pipe(
  Layer.provide(CrewPlatformProcessesLive),
  Layer.provide(ZeropsTurnAdmissionLive),
  Layer.provide(ZeropsAgentAuthLive),
  Layer.provide(ZeropsLoginsLive),
  Layer.provide(ZeropsProjectSignersModule.layer),
  Layer.provide(providerInstancesLayer),
  Layer.provide(ProcessRunner.layer),
);

/** The Mate's update line (spec-mate §2.9): read by the descriptor and followed by the link. */
const ZeropsMateUpdateLive = ZeropsMateUpdateModule.layer.pipe(
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
  Layer.provide(ZeropsCrewLive),
  Layer.provide(providerInstancesLayer),
  Layer.provide(ZeropsAgentLoginModule.layer),
  Layer.provide(ZeropsAgentAuthLive),
  Layer.provide(ZeropsLoginsLive),
  Layer.provide(ZeropsProjectSignersModule.layer),
  Layer.provide(ZeropsMateUpdateLive),
  Layer.provide(ZeropsMateAttentionModule.layer),
);

const liveLayer = Layer.mergeAll(
  ZeropsLifecycle.layer.pipe(Layer.provide(ZeropsThreadLifecycle.layer)),
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
      ),
    ),
    Layer.provide(ZeropsProjectSignersModule.layer),
  ),
  ZeropsTurnAdmissionLive,
  ZeropsCrewLive,
  // A new Mate's setup, reported at `/setup.json`, and its stand-up started
  // here once its asker has an agent to run — admitted through the same gate.
  // …and a running stand-up's progress, relayed from zcp's status file to its run card.
  ZeropsStandUpRelayModule.layer.pipe(
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
      ),
    ),
  ),
  ZeropsHqLinkLive,
  ZeropsBrowserStreamModule.layer,
  ZeropsMateUpdateLive,
  ZeropsDataConsoleModule.layer,
  ZeropsGitRemoteProbeModule.layer,
  // Not a feed: the loop that ends a session whose person's role changed. It
  // lives here because this is where the Zerops services are composed, and it
  // is deliberately absent from the fixture layer — a fixture scene has no
  // platform to re-read.
  ZeropsMembershipWatchModule.layer,
).pipe(
  // Who the project lets in — HQ's relay while it holds, else this Mate's own
  // read — for the watch, the signers and the door alike, written by the link
  // to HQ above; it reaches the door the same way the reader below does.
  Layer.provideMerge(ZeropsProjectAccessModule.layer),
  // Startup's one read of why running turns were interrupted, over the same own-key reader.
  Layer.provideMerge(ZeropsRestartReadModule.layer),
  // The org's member list, read once for the watch, the signers and the door
  // alike (`ZeropsOrgRead`), over the one own-key reader below; it reaches
  // the door the same way that reader does.
  Layer.provideMerge(ZeropsOrgReadModule.layer),
  // The process-wide own-key reader: one cache, one invalidation, shared by
  // the watch and the signers gate above, and (via this layer's own merged
  // output flowing up through the runtime composition in `server.ts`) by the
  // door's `verifyThrowawayCaller` too. `ZeropsIdentityStatus` is NOT
  // provided here — it is provided once, above both this tree and
  // `ServerEnvironment.layer`, in `server.ts`'s `RuntimeBaseDependenciesLive`
  // — providing a second instance here would shadow that one for everything
  // under this tree and break the sharing the descriptor (S4) depends on.
  Layer.provideMerge(ZeropsMateKeyModule.layer),
  // Who signed each login in, as this server saw it: one store, written by the login walker
  // and read by the gate, the feeds, the setup and the link to HQ.
  Layer.provide(ZeropsSignInsModule.layer),
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
);
