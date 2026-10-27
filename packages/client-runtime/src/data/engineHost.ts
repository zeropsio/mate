/**
 * The account's engine conversations: one host per account store — its subscriptions, its
 * operations and its streamed text — and the route a Mate's conversation takes, decided at the
 * door from the protocol its descriptor names: the engine, or an update of the app or the Mate.
 *
 * @module data/engineHost
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { PreparedConnection } from "../connection/model.ts";
import {
  engineProtocol,
  makeEngineConversationWire,
  makeMateEngineConversations,
} from "./adapters/mateEngine.ts";
import { ENGINE_LIVE_POLICY, makeEngineLiveText, type EngineLiveText } from "./engineLive.ts";
import {
  makeEngineCallWire,
  makeMateEngineOperations,
  type MateEngineOperations,
} from "./operations/executors/mateEngine.ts";
import type { AccountStore } from "./store.ts";

export interface MateEngineHost {
  readonly store: AccountStore;
  /** The registry the store publishes into: where its projections are read. */
  readonly atoms: AtomRegistry.AtomRegistry;
  readonly conversations: ReturnType<typeof makeMateEngineConversations>;
  readonly operations: MateEngineOperations;
  readonly live: EngineLiveText;
  /**
   * Published pages: a height this client laid one out at, recorded for its later views. A view's
   * own measurement, sent once and forgotten: a failure only means a later view measures again.
   */
  readonly pages: {
    readonly recordHeight: (input: {
      readonly environmentId: string;
      readonly conversationId: string;
      readonly itemId: string;
      readonly width: number;
      readonly height: number;
    }) => void;
  };
  readonly close: () => void;
}

/** This client and the Mate speak no common protocol: the person updates one. Never retried. */
export class MateEngineUnsupported extends Schema.TaggedError<MateEngineUnsupported>()(
  "MateEngineUnsupported",
  { message: Schema.String },
) {}

/** The signed-in account's host; `null` until its store mounts. */
export const mateEngineHostAtom = Atom.make<MateEngineHost | null>(null).pipe(Atom.keepAlive);

export function makeMateEngineHost(options: {
  readonly store: AccountStore;
  readonly atoms: AtomRegistry.AtomRegistry;
  readonly registry: EnvironmentRegistry["Service"];
  readonly makeId: () => string;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}): MateEngineHost {
  const live = makeEngineLiveText({
    policy: ENGINE_LIVE_POLICY,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });
  const wire = makeEngineConversationWire(options.registry);
  const conversations = makeMateEngineConversations({
    store: options.store,
    wire,
    live,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });
  const operations = makeMateEngineOperations({
    store: options.store,
    wire: makeEngineCallWire(options.registry),
    makeId: options.makeId,
  });
  return {
    store: options.store,
    atoms: options.atoms,
    conversations,
    operations,
    live,
    pages: {
      recordHeight: ({ environmentId, conversationId, itemId, width, height }) => {
        Effect.runFork(
          (
            wire.recordPageHeight?.({ environmentId, conversationId }, itemId, width, height) ??
            Effect.void
          ).pipe(Effect.ignore),
        );
      },
    },
    close: () => {
      operations.close();
      conversations.close();
      live.close();
    },
  };
}

/** Where a Mate's conversation is read and written. */
export type EngineRoute =
  | { readonly kind: "unknown" }
  | { readonly kind: "engine"; readonly protocol: number }
  /** The Mate serves only a newer protocol: the person updates the app. */
  | { readonly kind: "update" }
  /** The Mate serves no engine (a build from before it): the person updates the Mate. */
  | { readonly kind: "older" };

export function engineRouteOf(prepared: Pick<PreparedConnection, "mateEngine">): EngineRoute {
  if (prepared.mateEngine === undefined) return { kind: "older" };
  const protocol = engineProtocol(prepared.mateEngine);
  return protocol === null ? { kind: "update" } : { kind: "engine", protocol };
}
