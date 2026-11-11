/**
 * KeyedCoalescingWorker - A keyed worker that keeps only the latest value per key.
 *
 * Enqueues for an active or already-queued key are merged atomically instead of
 * creating duplicate queued items. Each batch yields to other queued keys before
 * processing newer updates. `settleKey()` resolves once the work enqueued
 * before it was called has been processed, so a key that keeps receiving work
 * cannot hold it forever.
 *
 * @module KeyedCoalescingWorker
 */
import * as Scope from "effect/Scope";
import * as Effect from "effect/Effect";
import * as TxQueue from "effect/TxQueue";
import * as TxRef from "effect/TxRef";

export interface KeyedCoalescingWorker<K, V> {
  readonly enqueue: (key: K, value: V) => Effect.Effect<void>;
  readonly settleKey: (key: K) => Effect.Effect<void>;
}

interface KeyedCoalescingWorkerState<K, V> {
  readonly latestByKey: Map<K, V>;
  readonly queuedKeys: Set<K>;
  readonly activeKeys: Set<K>;
  /** Newest enqueue per key with work outstanding; absent once the key is idle. */
  readonly enqueuedSeq: Map<K, number>;
  /** Newest enqueue per key whose batch has been processed; absent once the key is idle. */
  readonly settledSeq: Map<K, number>;
}

export const makeKeyedCoalescingWorker = <K, V, E, R>(options: {
  readonly merge: (current: V, next: V) => V;
  readonly process: (key: K, value: V) => Effect.Effect<void, E, R>;
}): Effect.Effect<KeyedCoalescingWorker<K, V>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(TxQueue.unbounded<K>(), TxQueue.shutdown);
    const stateRef = yield* TxRef.make<KeyedCoalescingWorkerState<K, V>>({
      latestByKey: new Map(),
      queuedKeys: new Set(),
      activeKeys: new Set(),
      enqueuedSeq: new Map(),
      settledSeq: new Map(),
    });
    let nextSeq = 0;

    // Return dirty keys to the tail on success or failure. Keep pending values
    // available for merging until the next batch starts.
    const completeKey = (key: K, seq: number): Effect.Effect<void> =>
      TxRef.modify(stateRef, (state) => {
        const activeKeys = new Set(state.activeKeys);
        activeKeys.delete(key);
        const enqueuedSeq = new Map(state.enqueuedSeq);
        const settledSeq = new Map(state.settledSeq);

        if (!state.latestByKey.has(key)) {
          // Idle: every enqueue for this key is settled.
          enqueuedSeq.delete(key);
          settledSeq.delete(key);
          return [false, { ...state, activeKeys, enqueuedSeq, settledSeq }] as const;
        }

        settledSeq.set(key, seq);
        if (!state.queuedKeys.has(key)) {
          const queuedKeys = new Set(state.queuedKeys);
          queuedKeys.add(key);
          return [true, { ...state, activeKeys, queuedKeys, settledSeq }] as const;
        }

        return [false, { ...state, activeKeys, settledSeq }] as const;
      }).pipe(
        Effect.flatMap((shouldRequeue) =>
          shouldRequeue ? TxQueue.offer(queue, key) : Effect.void,
        ),
        Effect.tx,
        Effect.asVoid,
      );

    yield* TxQueue.take(queue).pipe(
      Effect.flatMap((key) =>
        TxRef.modify(stateRef, (state) => {
          const queuedKeys = new Set(state.queuedKeys);
          queuedKeys.delete(key);

          const value = state.latestByKey.get(key);
          if (value === undefined) {
            return [null, { ...state, queuedKeys }] as const;
          }

          const latestByKey = new Map(state.latestByKey);
          latestByKey.delete(key);
          const activeKeys = new Set(state.activeKeys);
          activeKeys.add(key);

          return [
            { key, value, seq: state.enqueuedSeq.get(key) ?? 0 } as const,
            { ...state, latestByKey, queuedKeys, activeKeys },
          ] as const;
        }).pipe(Effect.tx),
      ),
      Effect.flatMap((item) =>
        item === null
          ? Effect.void
          : options
              .process(item.key, item.value)
              .pipe(Effect.ignoreCause, Effect.ensuring(completeKey(item.key, item.seq))),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    const enqueue: KeyedCoalescingWorker<K, V>["enqueue"] = (key, value) =>
      TxRef.modify(stateRef, (state) => {
        const latestByKey = new Map(state.latestByKey);
        const existing = latestByKey.get(key);
        latestByKey.set(key, existing === undefined ? value : options.merge(existing, value));
        const seq = ++nextSeq;
        const enqueuedSeq = new Map(state.enqueuedSeq);
        const settledSeq = state.settledSeq.has(key)
          ? state.settledSeq
          : // A key with no settled mark was idle: everything before this enqueue is settled.
            new Map(state.settledSeq).set(key, seq - 1);
        enqueuedSeq.set(key, seq);

        if (state.queuedKeys.has(key) || state.activeKeys.has(key)) {
          return [false, { ...state, latestByKey, enqueuedSeq, settledSeq }] as const;
        }

        const queuedKeys = new Set(state.queuedKeys);
        queuedKeys.add(key);
        return [true, { ...state, latestByKey, queuedKeys, enqueuedSeq, settledSeq }] as const;
      }).pipe(
        Effect.flatMap((shouldOffer) => (shouldOffer ? TxQueue.offer(queue, key) : Effect.void)),
        Effect.tx,
        Effect.asVoid,
      );

    // Capture the target in its own transaction: a retry re-reads only the
    // settled mark, so newer enqueues cannot move the target.
    const settleKey: KeyedCoalescingWorker<K, V>["settleKey"] = (key) =>
      TxRef.get(stateRef).pipe(
        Effect.tx,
        Effect.flatMap((state) => {
          const target = state.enqueuedSeq.get(key);
          if (target === undefined) return Effect.void;
          return TxRef.get(stateRef).pipe(
            Effect.tap((current) => {
              const settled = current.settledSeq.get(key);
              return settled === undefined || settled >= target ? Effect.void : Effect.txRetry;
            }),
            Effect.asVoid,
            Effect.tx,
          );
        }),
      );

    return { enqueue, settleKey } satisfies KeyedCoalescingWorker<K, V>;
  });
