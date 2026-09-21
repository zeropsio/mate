/**
 * What holds the *New project* button back — the judgement, not the pixels.
 *
 * The account's registry lives on its Gitea project and is read once, before
 * the person reaches the button, so that pressing it never waits. That read
 * has three ends, and only one of them may hold the button.
 */

/** Where the one registry read has got to. */
export type RegistryReadState = "loading" | "ready" | "failed";

/**
 * Whether the create must wait for the account's registry.
 *
 * **Only a read still in flight holds it.** Pressing during that window would
 * send `home: undefined` into a create whose `ensureGitea` stands a *second*
 * Gitea up beside the one about to answer — which is the whole reason a gate
 * is here at all.
 *
 * A read that **failed** does not hold it, and that distinction is the bug this
 * function exists to fix (mate.zerops.io, 2026-09-21: a filled form and a
 * button that did nothing). The gate used to be `registry === null`, which is
 * one value for both ends: a failed read left it null for ever — the `.catch`
 * swallows, nothing retries — so the only button on the page was disabled with
 * no spinner, no message and no way out. `createProject` is already written for
 * a null registry, and the read's own comment says so in as many words: _"a
 * registry that cannot be read is a create that will say so when it is tried"_.
 * It could not be tried.
 */
export function registryHoldsCreate(input: {
  /** Whether the account's inventory names a Gitea project at all. */
  readonly giteaKnown: boolean;
  readonly registryRead: RegistryReadState;
}): boolean {
  return input.giteaKnown && input.registryRead === "loading";
}
