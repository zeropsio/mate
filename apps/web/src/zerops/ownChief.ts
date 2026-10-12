/**
 * The viewer's own Chief in the organization in view, as HQ answers it (`GET /api/chief`), and
 * the Chiefs of everybody else, which no surface draws (`chief.ts`).
 *
 * A reload starts from what the last visit had HQ say (`mateIdentityMemory.ts`), so the top row
 * paints the Chief on its first frame; HQ's answer replaces it. An organization without an HQ has
 * no Chief to hold.
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { Atom } from "effect/reactivity";
import { useCallback, useContext, useEffect } from "react";

import { sameValue } from "../lib/sameValue";
import { mateRowsAtom, zeropsSessionAtom } from "../state/zerops";
import { useAccountHq, useOfficialHq } from "./accountHq";
import { othersChiefs, type OwnChief } from "./chief";
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

/** Every listed project that is someone else's Chief: drawn nowhere. */
export const othersChiefsAtom = Atom.make((get): ReadonlySet<string> =>
  othersChiefs(
    heldCandidates(get(mateRowsAtom)).rows.map((row) => row.project),
    get(ownChiefAtom),
  ),
).pipe(
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
 * Asks HQ whose Chief the viewer has, once per organization and HQ. An organization HQ is known to
 * be missing from has none. A read that fails keeps what was known.
 */
export function useOwnChiefRead(): void {
  const session = useZeropsSessionOptional();
  const orgId = session?.activeOrganization?.id;
  const accountHq = useAccountHq(orgId);
  const official = useOfficialHq();
  const keep = useKeepOwnChief();
  const noHq = accountHq.status === "ready" && accountHq.hq.kind === "none";
  useEffect(() => {
    if (orgId === undefined) return;
    if (noHq) {
      keep(orgId, null);
      return;
    }
    if (official === null) return;
    const controller = new AbortController();
    official.api.chief(controller.signal).then(
      (chief) => {
        if (!controller.signal.aborted) keep(orgId, chief?.projectId ?? null);
      },
      () => {
        /* HQ did not answer: what was known stands until it does. */
      },
    );
    return () => controller.abort();
  }, [keep, noHq, official, orgId]);
}
