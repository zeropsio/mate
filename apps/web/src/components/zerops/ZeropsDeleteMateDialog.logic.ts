/**
 * Deleting a Mate, in words and rules: what its dialog says, when the name is typed, and where the
 * viewer stands once it is gone.
 *
 * A Mate is its workspace — one Zerops project — so deleting it takes that project off Zerops
 * with its services and whatever is in them, and its conversations, which live in its container,
 * go with it. The dialog says so in one paragraph and asks for the Mate's name, typed, before its
 * button deletes anything: nothing about this can be undone.
 */
import type { ZeropsEnvironmentServices } from "@t3tools/client-runtime/zerops";
import type { HqBirthLeft } from "@t3tools/client-runtime/zerops/hq";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

/** What a Mate on its way off Zerops says: its dialog's button, and its row's line. */
export const MATE_DELETING_WORD = "Deleting…";

/** What the Delete dialog says. */
export interface DeleteMateWords {
  /** "Delete Quinn?" */
  readonly title: string;
  /** The one paragraph: what goes, and that it does not come back. */
  readonly body: string;
  /** The button: "Delete Quinn". */
  readonly submit: string;
  /** The button while the platform answers. */
  readonly pending: string;
}

/**
 * Every service the deletion takes off Zerops, counted from what its row already read: its
 * developer's (`summarizeEnvironmentServices`) and the Mate's own container, which that summary
 * leaves out — the services the project shows in Zerops (e2e 2026-10-03: zcp, appdev and
 * appstage read "its 2 services"). `undefined` while its services are unread.
 */
export function deleteMateServiceCount(candidate: {
  readonly service?: ZeropsCandidate["service"];
  readonly services?: Pick<ZeropsEnvironmentServices, "hostnames">;
}): number | undefined {
  const own = candidate.services?.hostnames.length;
  if (own === undefined) return undefined;
  return candidate.service === undefined ? own : own + 1;
}

/**
 * What goes with the environment (`deleteMateServiceCount`), in the singular or the plural; no
 * service at all; not read yet, and the words carry no number they cannot back.
 */
function whatGoesWithIt(services: number | undefined): string {
  if (services === undefined) return "with its services and everything in them";
  if (services === 0) return "with everything in it";
  if (services === 1) return "with its 1 service and everything in it";
  return `with its ${services} services and everything in them`;
}

/**
 * The last Mate in its project's Delete, the first line of what goes: deleting the project deletes
 * it first, with its conversations and its workspace.
 */
export function lastMateGoes(name: string, services: number | undefined): string {
  return `${name}, its conversations, and its workspace ${whatGoesWithIt(services)}`;
}

export function deleteMateWords(input: {
  /** The Mate's name. */
  readonly name: string;
  /** Its environment's name: the Zerops project it lives in. */
  readonly environment: string;
  /** Every service that goes with it (`deleteMateServiceCount`); `undefined` while unread. */
  readonly services: number | undefined;
  /** Whose Mate it is, where that is a colleague — "Ada's Mate", as its row says it. */
  readonly owner: string | undefined;
  /** What stays of its project (`deletionOffer`), its last sentence; absent: it stands in none. */
  readonly stays?: string | undefined;
}): DeleteMateWords {
  const { name, environment, owner, stays } = input;
  const whose = owner === undefined ? "" : `${name} is ${owner}'s Mate. `;
  return {
    title: `Delete ${name}?`,
    body:
      `${whose}The workspace ${environment} goes from Zerops ${whatGoesWithIt(input.services)}, ` +
      `and ${name}'s conversations go with it. Anything ${name} hasn't pushed is lost. ` +
      "This can't be undone." +
      (stays === undefined ? "" : ` ${stays}`),
    submit: `Delete ${name}`,
    pending: MATE_DELETING_WORD,
  };
}

/** The verb in a Mate's menu: its name, and the dialog it opens. */
export function deleteMateVerb(name: string): string {
  return `Delete ${name}…`;
}

/**
 * Whether the typed text is the Mate's name: exactly, spaces around it aside — the case, and any
 * space inside it, as the name is spelled.
 */
export function deleteMateConfirmed(typed: string, name: string): boolean {
  const trimmed = typed.trim();
  return trimmed.length > 0 && trimmed === name;
}

/**
 * The field that asks a name typed before something is deleted: what it asks in words, the
 * label it is pressed by (`Type {name} to confirm`), and
 * under it whether what is typed matches, or how it does not. The rule is
 * `deleteMateConfirmed`'s: spelled the same, spaces around it aside.
 */
export function confirmNameWords(input: {
  readonly name: string;
  /** Whose name it is: "the Mate's", "the project's", "the Production's". */
  readonly whose: string;
  readonly typed: string;
}): {
  readonly ask: string;
  readonly label: string;
  readonly copyLabel: string;
  readonly matches: boolean;
  readonly match: string;
  readonly hint: string | null;
} {
  const matches = deleteMateConfirmed(input.typed, input.name);
  return {
    ask: `To confirm, type ${input.whose} name exactly as shown`,
    label: `Type ${input.name} to confirm`,
    copyLabel: `the name ${input.name}`,
    matches,
    match: "Matches",
    hint: matches
      ? null
      : input.typed.trim() === ""
        ? "Capitals, spaces and dashes count."
        : "Not the same yet: capitals, spaces and dashes count.",
  };
}

/** Where the viewer stands once the platform took the Mate. */
type DeleteLanding =
  | { readonly kind: "stay" }
  | { readonly kind: "mate"; readonly projectId: string }
  | { readonly kind: "projects" };

/**
 * Where the viewer goes once a Mate is deleted: nowhere, unless they were in its conversation —
 * then the next Mate of its project they may open, the one before it where it was the last, and
 * the projects where it stood alone.
 */
export function landingAfterDelete(input: {
  readonly deleted: string;
  /** The Mate whose conversation is open, if any. */
  readonly viewing: string | undefined;
  /**
   * The Mates of the deleted one's project in the menu's order, it among them; `opens` is false
   * for one the viewer may not open, or one going too.
   */
  readonly siblings: ReadonlyArray<{ readonly projectId: string; readonly opens: boolean }>;
}): DeleteLanding {
  if (input.viewing !== input.deleted) return { kind: "stay" };
  const at = input.siblings.findIndex((mate) => mate.projectId === input.deleted);
  const opens = (mate: { readonly projectId: string; readonly opens: boolean }) =>
    mate.opens && mate.projectId !== input.deleted;
  const after = at === -1 ? undefined : input.siblings.slice(at + 1).find(opens);
  const before = at === -1 ? undefined : input.siblings.slice(0, at).findLast(opens);
  const next = after ?? before;
  return next === undefined ? { kind: "projects" } : { kind: "mate", projectId: next.projectId };
}

/** Each thing an adopted birth's attempt left in the project, as its Delete dialog names it. */
const LEFT_WORDS: Readonly<Record<HqBirthLeft, string>> = {
  zcp_service: "its zcp service",
  mate_key: "the Mate key it made, which HQ no longer accepts",
  mate_tag: "the project's mate tag",
  isolation: "the isolation settings it changed",
  owner_grant: "the owner access it granted",
  zcp_enabled:
    "the Mate settings it wrote to the project's own zcp service, which now refuses that key",
};

/**
 * The body of an adopted birth's Delete: it stops the setup, deletes nothing in Zerops, and names
 * what HQ's records say the attempt left in the project (`SharedBirth.left`), for the person to
 * remove in Zerops if they want.
 */
export function adoptedBirthDeleteBody(left: ReadonlyArray<HqBirthLeft> | undefined): string {
  const stops = "This stops setting up the Mate and deletes nothing in Zerops.";
  const check =
    "A step it was in the middle of may have added more, so check the project in Zerops before removing anything.";
  if (left === undefined) return `${stops} HQ no longer holds this setup open. ${check}`;
  if (left.length === 0) return `${stops} HQ records no change to the existing project. ${check}`;
  return `${stops} HQ records these in the project, and they stay: ${left.map((thing) => LEFT_WORDS[thing]).join(", ")}. ${check}`;
}

/** What HQ says an open birth left now, by its id; `undefined` once HQ holds it open no more. */
export function openBirthLeft(
  births: ReadonlyArray<{ readonly id: string; readonly left?: ReadonlyArray<HqBirthLeft> }>,
  birthId: string,
): ReadonlyArray<HqBirthLeft> | undefined {
  const birth = births.find((birth) => birth.id === birthId);
  return birth === undefined ? undefined : (birth.left ?? []);
}
