/**
 * The Zerops feeds as one layer, so the server's runtime composition takes a
 * single line for both.
 *
 * The lifecycle and authorization feeds are independent by design, so a
 * failure in one never blanks the other. `ZeropsAgentLogin` is the one
 * exception: it calls `ZeropsAgentAuth.recheckNow` on a login success, so its
 * layer retains the authorization service it receives. `ws.ts` and the login
 * module therefore share the SAME `ZeropsAgentAuth` instance.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsBrowserStreamModule from "./ZeropsBrowserStream.ts";
import * as ZeropsCliModule from "./ZeropsCli.ts";
import * as ZeropsDataConsoleModule from "./ZeropsDataConsole.ts";
import * as ZeropsGitRemoteProbeModule from "./ZeropsGitRemoteProbe.ts";
import { loadFixtureScene, makeFixtureZeropsLayer } from "./ZeropsFixtureFeeds.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsMateUpdateModule from "./ZeropsMateUpdate.ts";
import * as ZeropsMembershipWatchModule from "./ZeropsMembershipWatch.ts";
import * as ZeropsProjectSignersModule from "./ZeropsProjectSigners.ts";

const liveLayer = Layer.mergeAll(
  ZeropsLifecycle.layer.pipe(Layer.provide(ZeropsThreadLifecycle.layer)),
  // `ZeropsProjectSigners` is merged rather than hidden: the agent-auth feed
  // reads who signed each agent in for its snapshot, and `ws.ts` asks the same
  // service before it lets a turn start (D6). One reader, one cache.
  ZeropsAgentLoginModule.layer.pipe(
    Layer.provideMerge(ZeropsAgentAuth.layer),
    Layer.provideMerge(ZeropsProjectSignersModule.layer),
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
