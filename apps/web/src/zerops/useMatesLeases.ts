/** Mate-wide copies demanded by the Sites and review surfaces. */
import { useAtomValue } from "@effect/atom-react";
import { mateCopiesRead } from "@t3tools/client-runtime/zerops/serviceMap";
import { Atom } from "effect/reactivity";

import { sameValue } from "../lib/sameValue";
import { zeropsFeeds } from "./feeds";
import { zeropsMatesAtom } from "./useZeropsMates";

export type MateLeasesRead = ReturnType<typeof mateCopiesRead>;

export type MatesLeases = Readonly<Record<string, MateLeasesRead | undefined>>;

const matesLeasesAtom = Atom.family((key: string) => {
  const projects = JSON.parse(key) as ReadonlyArray<string>;
  return Atom.make((get): MatesLeases => {
    const read: Record<string, MateLeasesRead | undefined> = {};
    const directory = get(zeropsMatesAtom);
    for (const projectId of projects) {
      const matches = [...directory].filter(([, mate]) => mate?.projectId === projectId);
      if (matches.length !== 1) continue;
      const environmentId = matches[0]![0];
      read[projectId] = mateCopiesRead(get(zeropsFeeds.copies(environmentId)));
    }
    return read;
  }).pipe(Atom.withEquality(sameValue), Atom.withLabel("zerops:sites-leases"));
});

export function useMatesLeases(mates: ReadonlyArray<{ readonly projectId: string }>): MatesLeases {
  return useAtomValue(matesLeasesAtom(JSON.stringify(mates.map(({ projectId }) => projectId))));
}
