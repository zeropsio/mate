/**
 * The Zerops feeds as one layer, so the server's runtime composition takes a
 * single line for both.
 *
 * The lifecycle and authorization feeds are independent by design, so a
 * failure in one never blanks the other. `ZeropsAgentLogin` is the one
 * exception: it calls `ZeropsAgentAuth.recheckNow` on a login success, so its
 * layer retains the authorization service it receives. `ws.ts` and the login
 * module therefore share the SAME `ZeropsAgentAuth` instance. `ZeropsAgentSignOut`
 * shares that same instance too, plus the same `ZeropsAgentLogin` instance —
 * see its own branch below for why.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import { layer as providerInstancesLayer } from "../spi/providerInstances.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentFlagModule from "./ZeropsAgentFlag.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsAgentSignOutModule from "./ZeropsAgentSignOut.ts";
import * as ZeropsBrowserStreamModule from "./ZeropsBrowserStream.ts";
import * as ZeropsCliModule from "./ZeropsCli.ts";
import * as ZeropsDataConsoleModule from "./ZeropsDataConsole.ts";
import * as ZeropsGitRemoteProbeModule from "./ZeropsGitRemoteProbe.ts";
import { loadFixtureScene, makeFixtureZeropsLayer } from "./ZeropsFixtureFeeds.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import * as ZeropsMateUpdateModule from "./ZeropsMateUpdate.ts";
import * as ZeropsMembershipWatchModule from "./ZeropsMembershipWatch.ts";
import * as ZeropsProjectSignersModule from "./ZeropsProjectSigners.ts";

/**
 * `ZeropsAgentAuth.layer` reaches the provider registry only through
 * `ProviderInstances` (`spi/providerInstances.ts`), discharged here so
 * `ProviderRegistry` bubbles up to the one shared instance `server.ts`
 * provides everywhere else — never a second registry.
 */
const ZeropsAgentAuthLive = ZeropsAgentAuth.layer.pipe(Layer.provide(providerInstancesLayer));

const liveLayer = Layer.mergeAll(
  ZeropsLifecycle.layer.pipe(Layer.provide(ZeropsThreadLifecycle.layer)),
  // `ZeropsProjectSigners` is merged rather than hidden: the agent-auth feed
  // reads who signed each agent in for its snapshot, and `ws.ts` asks the same
  // service before it lets a turn start (D6). One reader, one cache.
  ZeropsAgentLoginModule.layer.pipe(
    Layer.provideMerge(ZeropsAgentAuthLive),
    Layer.provideMerge(ZeropsProjectSignersModule.layer),
  ),
  // `ZeropsAgentSignOut` declares `ZeropsAgentLogin`/`ZeropsAgentAuth` as
  // REQUIREMENTS it locally `Layer.provide`s from the SAME `.layer` values
  // referenced above — Effect memoizes a layer by reference across one
  // build, so this is the one running instance of each, not a second copy.
  // A sibling `Layer.mergeAll(...)` branch would NOT do this: layers merged
  // as siblings are built independently against the ambient context and
  // never see each other's output, which is what leaked `ZeropsAgentLogin`
  // as an unmet requirement all the way up to `server.ts` the first time
  // this was tried — see `ZeropsAgentSignOut.ts`'s own layer doc comment.
  ZeropsAgentSignOutModule.layer.pipe(
    Layer.provide(ZeropsAgentLoginModule.layer),
    Layer.provide(ZeropsAgentAuthLive),
    Layer.provide(ZeropsAgentFlagModule.layer),
    Layer.provide(ZeropsProjectSignersModule.layer),
  ),
  ZeropsBrowserStreamModule.layer,
  ZeropsMateUpdateModule.layer.pipe(Layer.provideMerge(ZeropsCliModule.layer)),
  ZeropsDataConsoleModule.layer,
  ZeropsGitRemoteProbeModule.layer,
  // Not a feed: the loop that ends a session whose person's role changed. It
  // lives here because this is where the Zerops services are composed, and it
  // is deliberately absent from the fixture layer — a fixture scene has no
  // platform to re-read.
  ZeropsMembershipWatchModule.layer,
).pipe(
  // The process-wide own-key reader: one cache, one invalidation, shared by
  // the watch and the signers gate above, and (via this layer's own merged
  // output flowing up through the runtime composition in `server.ts`) by the
  // door's `verifyThrowawayCaller` too. `ZeropsIdentityStatus` is NOT
  // provided here — it is provided once, above both this tree and
  // `ServerEnvironment.layer`, in `server.ts`'s `RuntimeBaseDependenciesLive`
  // — providing a second instance here would shadow that one for everything
  // under this tree and break the sharing the descriptor (S4) depends on.
  Layer.provideMerge(ZeropsMateKeyModule.layer),
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
