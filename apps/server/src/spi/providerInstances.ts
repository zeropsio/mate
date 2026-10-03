/**
 * The provider-instance capability `apps/server/src/zerops/**` needs — a
 * proper Context.Service, so a caller that `yield*`s it gets an
 * already-resolved capability (`R = never` on every method) rather than
 * leaking a `ProviderRegistry` requirement into every closure that reaches
 * for it. Owned product reaches provider internals only through `spi/**`,
 * never `provider/**` directly (methodology §3.2).
 *
 * @module spi/providerInstances
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderAuthStatus,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";

/**
 * `ProviderDriverKind` for each agent's built-in driver
 * (`apps/server/src/provider/Drivers/{Claude,Codex}Driver.ts`'s own
 * `DRIVER_KIND` constants) — Claude Code's driver kind is `"claudeAgent"`,
 * not `"claude-code"` or `"claude"`.
 */
const AGENT_DRIVER_KIND: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "claudeAgent",
  codex: "codex",
};

/**
 * The provider instance each agent's own sign-in belongs to — the driver's
 * default (single-instance) id. Every further login is an instance of its own
 * (`zerops/ZeropsLogins.ts`), reconciled by id through `reconcileInstanceAuth`.
 */
export const agentDefaultInstanceId = (agentId: ZeropsAgentId): ProviderInstanceId =>
  defaultInstanceIdForDriver(ProviderDriverKind.make(AGENT_DRIVER_KIND[agentId]));

/**
 * Whether the picker's snapshot of `instanceId` definitely contradicts the
 * agent's verified sign-in. Only a definite answer on both sides counts: a
 * snapshot still `unknown` is either pending its own probe (the server's
 * startup check) or one the driver could not read, and a re-probe would only
 * duplicate that work.
 */
export const providerAuthDisagrees = (
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "auth">>,
  instanceId: ProviderInstanceId,
  verified: ServerProviderAuthStatus,
): boolean => {
  if (verified === "unknown") return false;
  const status = providers.find((provider) => provider.instanceId === instanceId)?.auth.status;
  return status !== undefined && status !== "unknown" && status !== verified;
};

export class ProviderInstances extends Context.Service<
  ProviderInstances,
  {
    /**
     * Re-probes the agent's provider instance when its snapshot — what the
     * model picker offers — contradicts the sign-in the agent's own CLI just
     * verified. The verified status stays the truth for `zerops/**`; this
     * only stops the picker from waiting for its next background refresh,
     * which runs every few minutes and only while a client is in the
     * foreground.
     */
    readonly reconcileAgentAuth: (
      agentId: ZeropsAgentId,
      verified: ServerProviderAuthStatus,
    ) => Effect.Effect<void>;
    /**
     * {@link reconcileAgentAuth} for one instance by its id — a login beyond
     * the defaults, whose own CLI check is the one that changed.
     */
    readonly reconcileInstanceAuth: (
      instanceId: string,
      verified: ServerProviderAuthStatus,
    ) => Effect.Effect<void>;
    /**
     * The driver kind of a configured instance (`ServerProvider.driver`), or
     * `undefined` for an id no configured instance carries.
     */
    readonly driverKindOf: (instanceId: string) => Effect.Effect<ProviderDriverKind | undefined>;
    /** The configured instances as the registry holds them now (`ServerProvider` each). */
    readonly providers: Effect.Effect<ReadonlyArray<ServerProvider>>;
  }
>()("t3/spi/providerInstances") {}

export const layer = Layer.effect(
  ProviderInstances,
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry;
    const reconcileInstanceAuth = (
      instanceId: ProviderInstanceId,
      verified: ServerProviderAuthStatus,
    ) =>
      Effect.gen(function* () {
        if (!providerAuthDisagrees(yield* registry.getProviders, instanceId, verified)) {
          return;
        }
        yield* registry.refreshInstance(instanceId);
      });
    return {
      reconcileAgentAuth: (agentId, verified) =>
        reconcileInstanceAuth(agentDefaultInstanceId(agentId), verified),
      reconcileInstanceAuth: (instanceId, verified) =>
        reconcileInstanceAuth(ProviderInstanceId.make(instanceId), verified),
      driverKindOf: (instanceId) =>
        registry.getProviders.pipe(
          Effect.map(
            (providers) => providers.find((provider) => provider.instanceId === instanceId)?.driver,
          ),
        ),
      providers: registry.getProviders,
    } satisfies ProviderInstances["Service"];
  }),
);
