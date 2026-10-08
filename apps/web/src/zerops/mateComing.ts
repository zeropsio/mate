/** Wording for the shared account arrival decision. */
import { routeGatePhrase, type RouteGatePhrase } from "@t3tools/client-runtime/zerops/environments";
import type { MateComing, MateComingPage } from "@t3tools/client-runtime/data";
/** A name the headline never breaks inside. */
const keptWhole = (name: string) => name.replaceAll(" ", " ");

/**
 * What a Mate's own view says in its headline: coming up, or not come (`MateComing`); on its way
 * to its conversation (`reaching`); or not to be opened (`unreachable`).
 */
export type MateViewKind = MateComing["kind"] | "reaching" | "unreachable";

/**
 * Its own view's headline, in the empty conversation's voice — "Quinn is coming up on Acme
 * Docs." while it comes, "Quinn could not be added to Acme Docs." if it did not: the words of the
 * button that made it — with no name torn in two. Any other Mate is its name alone: the line under
 * it says what it waits for, or why it cannot be opened, in its machine's words.
 */
export function mateComingHeadlineClauses(
  mate: { readonly name: string; readonly project: string | undefined },
  kind: MateViewKind,
): ReadonlyArray<string> {
  const name = keptWhole(mate.name);
  const on = mate.project === undefined ? "" : ` on ${keptWhole(mate.project)}`;
  const to = mate.project === undefined ? "" : ` to ${keptWhole(mate.project)}`;
  switch (kind) {
    case "coming":
      return [`${name} is coming up${on}.`];
    case "failed":
      return [`${name} could not be added${to}.`];
    case "reaching":
    case "unreachable":
      return [name];
  }
}

/**
 * The line under a Mate's name in its own view, in the route gate's words for the same verdict
 * (§4.8, one phrase producer): what its link waits for while it is on its way — "Opening this
 * conversation…" while its machine has nothing more to say — and why it cannot be opened, each
 * with its verbs.
 */
export function mateOpeningPhrase(
  page: Extract<MateComingPage, { readonly kind: "reaching" | "unreachable" }>,
  context: { readonly nowMs: number; readonly mateName: string },
): RouteGatePhrase {
  if (page.kind === "unreachable") {
    return routeGatePhrase({ kind: "unavailable", reachability: page.reachability }, context);
  }
  const waiting = routeGatePhrase({ kind: "wait", reachability: page.reachability }, context);
  return waiting.text === null
    ? routeGatePhrase({ kind: "wait", reachability: null }, context)
    : waiting;
}
