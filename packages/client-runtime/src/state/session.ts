import type { AuthSessionState, EnvironmentId, ServerConfig } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { HttpClient } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import { followStreamInEnvironment } from "./runtime.ts";

function initialConfigOption<E>(
  initialConfig: Effect.Effect<ServerConfig, E>,
): Effect.Effect<Option.Option<ServerConfig>> {
  return initialConfig.pipe(
    Effect.asSome,
    Effect.catch((error) =>
      Effect.logWarning("Could not load the initial environment configuration.").pipe(
        Effect.annotateLogs({ ...safeErrorLogAttributes(error) }),
        Effect.as(Option.none<ServerConfig>()),
      ),
    ),
  );
}

export { fetchEnvironmentSessionState } from "../data/adapters/mateClientAccess.ts";
import { fetchEnvironmentSessionState } from "../data/adapters/mateClientAccess.ts";

export function createEnvironmentSessionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const initialConfigAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.pipe(
            Effect.map((supervisor) =>
              SubscriptionRef.changes(supervisor.session).pipe(
                Stream.mapEffect(
                  Option.match({
                    onNone: () => Effect.succeed(Option.none<ServerConfig>()),
                    onSome: (session) => initialConfigOption(session.initialConfig),
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
      { initialValue: Option.none() },
    ),
  );

  // This is only the bootstrap config captured when a transport session is
  // established. Consumers that need current provider/settings state must use
  // createServerEnvironmentAtoms(...).configValueAtom instead.
  const initialConfigValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ServerConfig | null =>
      Option.getOrNull(
        Option.getOrElse(AsyncResult.value(get(initialConfigAtom(environmentId))), () =>
          Option.none(),
        ),
      ),
    ).pipe(Atom.withLabel(`environment-config-value:${environmentId}`)),
  );

  const preparedConnectionAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.pipe(
            Effect.map((supervisor) => SubscriptionRef.changes(supervisor.prepared)),
          ),
        ),
      ),
      { initialValue: Option.none<PreparedConnection>() },
    ),
  );

  const preparedConnectionValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      Option.getOrElse(AsyncResult.value(get(preparedConnectionAtom(environmentId))), () =>
        Option.none<PreparedConnection>(),
      ),
    ).pipe(Atom.withLabel(`environment-prepared-connection:${environmentId}`)),
  );

  // Keyed on the prepared connection's identity: a reconnect (new credential,
  // new base URL) swaps the prepared value, which re-runs the fetch, so scope
  // changes from re-pairing are picked up without an explicit refresh.
  const sessionStateAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime
      .atom((get) => {
        const prepared = Option.getOrNull(get(preparedConnectionValueAtom(environmentId)));
        if (prepared === null) {
          return Effect.never;
        }
        return Effect.gen(function* () {
          const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
          return yield* fetchEnvironmentSessionState({ prepared, signer });
        });
      })
      .pipe(
        Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
        Atom.setIdleTTL(5 * 60_000),
        Atom.withLabel(`environment-session-state:${environmentId}`),
      ),
  );

  const sessionStateValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): AuthSessionState | null =>
        Option.getOrNull(AsyncResult.value(get(sessionStateAtom(environmentId)))) ?? null,
    ).pipe(Atom.withLabel(`environment-session-state-value:${environmentId}`)),
  );

  return {
    initialConfigAtom,
    initialConfigValueAtom,
    preparedConnectionAtom,
    preparedConnectionValueAtom,
    sessionStateAtom,
    sessionStateValueAtom,
  };
}

/** Connection preparation is transport state, separate from published source facts. */
export function createPreparedConnectionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const preparedConnectionAtom = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          Effect.map(EnvironmentSupervisor, (supervisor) =>
            SubscriptionRef.changes(supervisor.prepared),
          ),
        ),
      ),
      { initialValue: Option.none<PreparedConnection>() },
    ),
  );
  const preparedConnectionValueAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) =>
      Option.getOrElse(AsyncResult.value(get(preparedConnectionAtom(environmentId))), () =>
        Option.none<PreparedConnection>(),
      ),
    ),
  );
  return { preparedConnectionAtom, preparedConnectionValueAtom };
}
