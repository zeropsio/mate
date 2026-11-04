/**
 * An ask: one thing a Mate needs from a person, raised in the conversation — approve a prepared
 * change, provide a value only they have, connect a sign-in, reveal what the agent cannot see,
 * choose an answer. Every kind maps its own source (the vault, the engine's request record, HQ's
 * decision record, the MCP list) onto these seven states, so every card says a state in the same
 * words, and a reload draws what the source says: nothing here is remembered by a card.
 */

/**
 * The only states an ask stands in, with the words its footer says. `waiting`: the main action
 * and "Not now". `working`: the press under way, as the pressed control (`main`, `notNow`), or as
 * a line while something outside the card finishes (`null`: a device to confirm on, a sign-in
 * tab). `done`: the real result and who; `told` is what the Mate hears of it. `notNow`: who and
 * when. `failed`: the source's own sentence. `othersToAnswer`: who can, by name. `replaced`: what
 * took its place.
 */
export type AskState =
  | { readonly kind: "waiting" }
  | {
      readonly kind: "working";
      readonly words: string;
      readonly pressed: "main" | "notNow" | null;
    }
  | { readonly kind: "done"; readonly words: string; readonly told: string | null }
  | { readonly kind: "notNow"; readonly words: string }
  | { readonly kind: "failed"; readonly words: string }
  | { readonly kind: "othersToAnswer"; readonly words: string }
  | { readonly kind: "replaced"; readonly words: string };

export type AskStateKind = AskState["kind"];

/** The second button of every ask: the Mate can ask again. Never Decline or Dismiss. */
export const NOT_NOW = "Not now";

/** The word for a value the vault does not show: never "secret". */
export const KEEP_HIDDEN = "Keep hidden";

/**
 * Where an ask acts, as its chip names it: this Mate, Stage, Production, the project or the
 * organization, and the service or name inside it (`detail`).
 */
export interface AskWhere {
  readonly scope: "mate" | "stage" | "production" | "project" | "organization";
  readonly detail: string | null;
}

const SCOPE_WORDS: Readonly<Record<AskWhere["scope"], string>> = {
  mate: "This Mate",
  stage: "Stage",
  production: "Production",
  project: "Project",
  organization: "Organization",
};

/** The chip's words: "Production · api", "This Mate · every app", "Stage". */
export function askWhereWords(where: AskWhere): string {
  const scope = SCOPE_WORDS[where.scope];
  return where.detail === null ? scope : `${scope} · ${where.detail}`;
}

/** Production is the only risk colour: its chip and its main button. */
export function isProduction(where: AskWhere): boolean {
  return where.scope === "production";
}

/** "Petr", "Petr and Jana", "Petr, Jana and Ota". */
export function namesWords(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** "Not now · Aleš, 15:04": who said it and when, as much as the source records. */
export function notNowWords(by: string | null, at: string | null): string {
  const when = [by, at].filter((part): part is string => part !== null).join(", ");
  return when === "" ? NOT_NOW : `${NOT_NOW} · ${when}`;
}

/** Someone else's ask: the rule, then who can by name — "… Petr and Jana can." */
export function authorityWords(rule: string, names: ReadonlyArray<string>): string {
  return names.length === 0 ? rule : `${rule} ${namesWords(names)} can.`;
}

/** The press that hands it on: "Ask Petr", the first who can; none when nobody is named. */
export function askWhomWords(names: ReadonlyArray<string>): string | null {
  return names[0] === undefined ? null : `Ask ${names[0]}`;
}

/**
 * Whether an ask stands above the composer as well as in the conversation: while it still waits
 * on someone, the Mate's turn has stopped on it, and its card is out of view. While the turn runs,
 * or while the card is on screen, the card is where the person is already looking.
 */
export function docksAboveComposer(
  state: AskStateKind,
  where: { readonly turnRunning: boolean; readonly cardOnScreen: boolean },
): boolean {
  if (where.turnRunning || where.cardOnScreen) return false;
  return (
    state === "waiting" || state === "working" || state === "failed" || state === "othersToAnswer"
  );
}
