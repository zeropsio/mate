/**
 * The account's engine conversations: one host per account store — its subscriptions, its
 * operations and its streamed text — and the route a Mate's conversation takes, decided at the
 * door from the protocol its descriptor names: the engine, V1, or the update route.
 *
 * @module data/engineHost
 */
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

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
  readonly conversations: ReturnType<typeof makeMateEngineConversations>;
  readonly operations: MateEngineOperations;
  readonly live: EngineLiveText;
  readonly close: () => void;
}

/**
 * Whether this client reads engine conversations at all. A V1-only app (mobile today) says `none`:
 * an engine Mate's writes are then refused at once with the update route, never retried.
 */
export const mateEngineReaderAtom = Atom.make<"engine" | "none">("engine").pipe(Atom.keepAlive);

/** This client cannot talk to an engine Mate: the person updates the app. Never retried. */
export class MateEngineUnsupported extends Schema.TaggedError<MateEngineUnsupported>()(
  "MateEngineUnsupported",
  { message: Schema.String },
) {}

/** The signed-in account's host; `null` until its store mounts. */
export const mateEngineHostAtom = Atom.make<MateEngineHost | null>(null).pipe(Atom.keepAlive);

export function makeMateEngineHost(options: {
  readonly store: AccountStore;
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
  const conversations = makeMateEngineConversations({
    store: options.store,
    wire: makeEngineConversationWire(options.registry),
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
    conversations,
    operations,
    live,
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
  | { readonly kind: "v1" }
  | { readonly kind: "engine"; readonly protocol: number }
  /** The Mate serves only a newer protocol: the person updates the app. */
  | { readonly kind: "update" };

export function engineRouteOf(prepared: Pick<PreparedConnection, "mateEngine">): EngineRoute {
  if (prepared.mateEngine === undefined) return { kind: "v1" };
  const protocol = engineProtocol(prepared.mateEngine);
  return protocol === null ? { kind: "update" } : { kind: "engine", protocol };
}
