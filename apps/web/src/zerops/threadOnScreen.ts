/**
 * The conversation open and visible on this page, by its scoped key: what a Mate's face reads as
 * seen the moment a result lands in it, before the visit is marked and HQ hears of it
 * (`MatesActivityInput.onScreen`). `null` while no conversation is shown or the page is hidden.
 */
import { RegistryContext } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useContext, useEffect } from "react";

export const threadOnScreenAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("zerops:thread-on-screen"),
);

/** Holds `threadKey` on screen while the page is visible; lets it go when it changes or unmounts. */
export function useThreadOnScreen(threadKey: string | null): void {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    if (threadKey === null) return;
    const show = () =>
      registry.set(threadOnScreenAtom, document.visibilityState === "hidden" ? null : threadKey);
    show();
    document.addEventListener("visibilitychange", show);
    return () => {
      document.removeEventListener("visibilitychange", show);
      if (registry.get(threadOnScreenAtom) === threadKey) registry.set(threadOnScreenAtom, null);
    };
  }, [registry, threadKey]);
}
