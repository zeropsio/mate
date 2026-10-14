/**
 * The viewer's own Chief in the organization in view, as HQ's navigation says it (each project's
 * person facts, `chief`), and the Chiefs of everybody else, which no surface draws (`chief.ts`).
 *
 * A reload starts from what the last visit had HQ say (`mateIdentityMemory.ts`), so the top row
 * paints the Chief on its first frame; HQ's answer replaces it. An organization without an HQ has
 * no Chief to hold.
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { shownHqMenuNavigationAtom, shownHqPersonFactsAtom } from "@t3tools/client-runtime/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { Atom } from "effect/reactivity";
import { useCallback, useContext, useEffect } from "react";

import { sameValue } from "../lib/sameValue";
import { mateRowsAtom, zeropsSessionAtom } from "../state/zerops";
import { useAccountHq } from "./accountHq";
import { hqOwnChief, othersChiefs, type OwnChief } from "./chief";
import { readChiefMemory, writeChiefMemory } from "./mateIdentityMemory";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

const ownChiefByOrg = Atom.family((orgId: string) =>
  Atom.make<OwnChief>(readChiefMemory(orgId)).pipe(
    Atom.keepAlive,
    Atom.withLabel(`zerops:own-chief:${orgId}`),
  ),
);

/** The viewer's own Chief in the organization in view. */
export const ownChiefAtom = Atom.make((get): OwnChief => {
  const orgId = get(zeropsSessionAtom)?.activeOrganization?.organizationId;
  return orgId === undefined ? undefined : get(ownChiefByOrg(orgId));
}).pipe(Atom.withLabel("zerops:own-chief"));

/** Current HQ evidence for setup offers; remembered absence cannot offer setup. */
export const hqOwnChiefAtom = Atom.make((get) =>
  hqOwnChief(get(shownHqPersonFactsAtom), get(shownHqMenuNavigationAtom).read === "read"),
);

export function useHqOwnChief(): OwnChief {
  return useAtomValue(hqOwnChiefAtom);
}

/** Every project that is someone else's Chief, by its tag or by HQ's word: drawn nowhere. */
export const othersChiefsAtom = Atom.make((get): ReadonlySet<string> => {
  const tagged = othersChiefs(
    heldCandidates(get(mateRowsAtom)).rows.map((row) => row.project),
    get(ownChiefAtom),
  );
  const told = Object.entries(get(shownHqPersonFactsAtom)).flatMap(([projectId, facts]) =>
    facts.chief === "another" ? [projectId] : [],
  );
  return told.length === 0 ? tagged : new Set([...tagged, ...told]);
}).pipe(
  Atom.withEquality<ReadonlySet<string>>((left, right) => sameValue([...left], [...right])),
  Atom.withLabel("zerops:others-chiefs"),
);

export function useOwnChief(): OwnChief {
  return useAtomValue(ownChiefAtom);
}

export function useOthersChiefs(): ReadonlySet<string> {
  return useAtomValue(othersChiefsAtom);
}

/** Records whose Chief the viewer has in `orgId`, and remembers it for the next visit. */
export function useKeepOwnChief(): (orgId: string, chief: string | null) => void {
  const registry = useContext(RegistryContext);
  return useCallback(
    (orgId, chief) => {
      registry.set(ownChiefByOrg(orgId), chief);
      writeChiefMemory(orgId, chief);
    },
    [registry],
  );
}

/**
 * Keeps whose Chief the viewer has, as HQ's navigation says it: the project whose person facts
 * say `mine`, else none once the list is read whole. An organization without an HQ has none.
 */
export function useOwnChiefRead(): void {
  const session = useZeropsSessionOptional();
  const orgId = session?.activeOrganization?.id;
  const accountHq = useAccountHq(orgId);
  const keep = useKeepOwnChief();
  const own = useHqOwnChief();
  const noHq = accountHq.status === "ready" && accountHq.hq.kind === "none";
  useEffect(() => {
    if (orgId === undefined) return;
    if (noHq) keep(orgId, null);
    else if (own !== undefined) keep(orgId, own);
  }, [keep, own, noHq, orgId]);
}
