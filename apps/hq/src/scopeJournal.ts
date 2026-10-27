import type {
  HqCursor,
  HqRemoval,
  HqScope,
  HqScopeDelivery,
  HqValue,
} from "@t3tools/shared/hqStream";

/** A bounded value journal. Retention loss resets this scope alone; omission is never a removal. */
export const makeScopeJournal = (
  scope: HqScope,
  initialIncarnation: string,
  retention = 128,
  removalRetention = 1024,
) => {
  let revision = 0;
  let incarnation = initialIncarnation;
  let generation = 0;
  const values = new Map<string, HqValue>();
  const removals = new Map<string, HqRemoval>();
  const history: HqScopeDelivery[] = [];
  return {
    keys: () => [...values.keys()],
    commit: (
      updates: ReadonlyArray<HqValue>,
      removed: ReadonlyArray<HqRemoval> = [],
      baseline = false,
    ) => {
      const moved = updates.filter(
        (entry) => JSON.stringify(values.get(entry.key)?.value) !== JSON.stringify(entry.value),
      );
      const gone = removed.filter(
        (entry) => values.has(entry.key) || removals.get(entry.key)?.reason !== entry.reason,
      );
      if (moved.length === 0 && gone.length === 0 && !baseline) return undefined;
      for (const entry of moved) {
        values.set(entry.key, entry);
        removals.delete(entry.key);
      }
      for (const entry of gone) {
        values.delete(entry.key);
        removals.set(entry.key, entry);
      }
      const rotated = baseline || removals.size > removalRetention;
      if (rotated) {
        while (removals.size > removalRetention) removals.delete(removals.keys().next().value!);
        generation += 1;
        incarnation = `${initialIncarnation}:${generation}`;
        revision = 0;
        history.length = 0;
      }
      revision += 1;
      const message: HqScopeDelivery = {
        type: rotated ? "scope-reset" : "scope-values",
        scope,
        incarnation,
        revision,
        values: rotated ? [...values.values()] : moved,
        removals: rotated
          ? [
              ...new Map(
                [...removals.values(), ...gone].map((entry) => [entry.key, entry]),
              ).values(),
            ]
          : gone,
      };
      history.push(message);
      if (history.length > retention) history.shift();
      return message;
    },
    resume: (
      cursor?: HqCursor,
      proven: ReadonlyArray<HqRemoval> = [],
    ): ReadonlyArray<HqScopeDelivery> => {
      if (
        cursor?.incarnation === incarnation &&
        cursor.revision <= revision &&
        cursor.revision >= (history[0]?.revision ?? revision + 1) - 1
      ) {
        const replay = history.filter((message) => message.revision > cursor.revision);
        if (
          !replay.some((message) =>
            message.removals.some((removal) => removal.reason === "no-access"),
          )
        )
          return replay;
      }
      return [
        {
          type: "scope-reset",
          scope,
          incarnation,
          revision,
          values: [...values.values()],
          removals: [
            ...new Map(
              [...removals.values(), ...proven].map((entry) => [entry.key, entry]),
            ).values(),
          ],
        },
      ];
    },
  };
};
