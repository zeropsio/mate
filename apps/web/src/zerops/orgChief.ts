/** The menu's top and the Chief page read the organisation's Chief from the shared account data layer. */
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateDirectoryAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import type { OrgChief } from "./chief";

export const orgChiefAtom = Atom.make((get): OrgChief => {
  const { chief } = get(shownHqMateDirectoryAtom);
  return chief.kind === "present" ? chief.projectId : chief.kind === "absent" ? null : undefined;
});

export function useOrgChief(): OrgChief {
  return useAtomValue(orgChiefAtom);
}
