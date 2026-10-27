/** Scope demand and value receipts for running-Core tests; atomic frames retain unread facts. */
import { assert } from "@effect/vitest";
import {
  hqScopeKey,
  type HqScope,
  type HqScopeDelivery,
  type HqRemoval,
  type HqValue,
} from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";
import type { startCore } from "./runningCore.ts";

type Core = Effect.Success<ReturnType<typeof startCore>>;
type TestSocket = Effect.Success<ReturnType<Core["socket"]>>;
interface Buffered {
  values: Array<{ scope: string; fact: HqValue }>;
  removals: Array<{ scope: string; fact: HqRemoval }>;
}
const unread = new WeakMap<TestSocket, Buffered>();
const buffer = (socket: TestSocket) => {
  let found = unread.get(socket);
  if (found === undefined) {
    found = { values: [], removals: [] };
    unread.set(socket, found);
  }
  return found;
};
const retain = (socket: TestSocket, message: HqScopeDelivery) => {
  const scope = hqScopeKey(message.scope);
  buffer(socket).values.push(...message.values.map((fact) => ({ scope, fact })));
  buffer(socket).removals.push(...message.removals.map((fact) => ({ scope, fact })));
};
export const scopeReset = (socket: TestSocket, scope: HqScope) =>
  Effect.gen(function* () {
    yield* socket.send({ type: "subscribe", scopes: [{ scope }] });
    const message = (yield* socket.takeWhere(
      "scope snapshot",
      (message) =>
        message.type === "scope-reset" &&
        hqScopeKey(message.scope as HqScope) === hqScopeKey(scope),
    )) as HqScopeDelivery;
    yield* socket.takeWhere(
      "scope ready",
      (message) =>
        message.type === "scope-ready" &&
        hqScopeKey(message.scope as HqScope) === hqScopeKey(scope),
    );
    return message.values;
  });
export const scopeValue = <A>(values: ReadonlyArray<HqValue>, key: string): A => {
  const found = values.find((value) => value.key === key);
  assert.isDefined(found, key);
  return found!.value as A;
};
export const nextScopeValue = <A>(
  socket: TestSocket,
  scope: HqScope,
  key: string,
  matches: (value: A) => boolean = () => true,
) =>
  Effect.gen(function* () {
    const pending = buffer(socket).values;
    const found = () =>
      pending.findIndex(
        (value) =>
          value.scope === hqScopeKey(scope) &&
          value.fact.key === key &&
          matches(value.fact.value as A),
      );
    if (found() < 0) {
      const message = (yield* socket.takeWhere(
        `scope value ${key}`,
        (message) =>
          message.type === "scope-values" &&
          hqScopeKey(message.scope as HqScope) === hqScopeKey(scope) &&
          (message.values as ReadonlyArray<HqValue>).some(
            (value) => value.key === key && matches(value.value as A),
          ),
      )) as HqScopeDelivery;
      retain(socket, message);
    }
    return pending.splice(found(), 1)[0]!.fact.value as A;
  });
export const scopeRemoval = (socket: TestSocket, scope: HqScope, key: string) =>
  Effect.gen(function* () {
    const pending = buffer(socket).removals;
    const found = () =>
      pending.findIndex((value) => value.scope === hqScopeKey(scope) && value.fact.key === key);
    if (found() < 0) {
      const message = (yield* socket.takeWhere(
        `scope removal ${key}`,
        (message) =>
          (message.type === "scope-values" || message.type === "scope-reset") &&
          hqScopeKey(message.scope as HqScope) === hqScopeKey(scope) &&
          (message.removals as ReadonlyArray<HqRemoval>).some((removal) => removal.key === key),
      )) as HqScopeDelivery;
      retain(socket, message);
    }
    return pending.splice(found(), 1)[0]!.fact;
  });
