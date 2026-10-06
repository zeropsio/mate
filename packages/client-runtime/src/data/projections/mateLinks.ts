/**
 * The Mates as this tab reads them (`families/mateLink.ts`): every Mate shown, each target's
 * environment and container machine, and one target's reading by its key. A projection recomputes
 * when a Mate's own reading changes; the same Mates read the same.
 *
 * @module data/projections/mateLinks
 */
import type { ContainerMachine } from "../../zerops/environments/containerMachine.ts";
import type { EnvironmentMachine } from "../../zerops/environments/environmentMachine.ts";
import { SHOWN_MATES, type MateLinkValue } from "../families/mateLink.ts";
import type { Projection } from "../store.ts";

export interface MateLinksRead {
  /** Each target shown, in key order. */
  readonly targets: ReadonlyMap<string, MateLinkValue>;
  readonly machines: ReadonlyMap<string, EnvironmentMachine>;
  readonly containers: ReadonlyMap<string, ContainerMachine>;
}

export const mateLinks: Projection<null, MateLinksRead> = {
  name: "mateLinks",
  keyOf: () => SHOWN_MATES.key,
  derive: (read) => {
    const targets = new Map<string, MateLinkValue>();
    for (const key of [...read.index(SHOWN_MATES.name, SHOWN_MATES.key)].sort()) {
      const fact = read.fact("mateLink", key);
      if (fact.kind === "known") targets.set(key, fact.value);
    }
    return {
      targets,
      machines: new Map([...targets].map(([key, link]) => [key, link.environment])),
      containers: new Map([...targets].map(([key, link]) => [key, link.container])),
    };
  },
  equals: (left, right) =>
    left.targets.size === right.targets.size &&
    [...left.targets].every(([key, link]) => right.targets.get(key) === link),
};

/** One target's reading; null for a Mate never read. */
export const mateLink: Projection<string, MateLinkValue | null> = {
  name: "mateLink",
  keyOf: (key) => key,
  derive: (read, key) => {
    const fact = read.fact("mateLink", key);
    return fact.kind === "known" ? fact.value : null;
  },
  equals: (left, right) => left === right,
};
