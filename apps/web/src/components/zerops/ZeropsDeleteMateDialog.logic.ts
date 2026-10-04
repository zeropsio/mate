/**
 * Deleting a Mate, in words and rules: what its dialog says, when the name is typed, which Mates
 * a menu offers it on, and where the viewer stands once it is gone.
 *
 * A Mate is its environment — one Zerops project — so deleting it takes that project off Zerops
 * with its services and whatever is in them, and its conversations, which live in its container,
 * go with it. The dialog says so in one paragraph and asks for the Mate's name, typed, before its
 * button deletes anything: nothing about this can be undone.
 */
import { hasMate, type ZeropsEnvironmentServices } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

/** What a Mate on its way off Zerops says: its dialog's button, and its row's line. */
export const MATE_DELETING_WORD = "Deleting…";

/** What the Delete dialog says. */
export interface DeleteMateWords {
  /** "Delete Quinn?" */
  readonly title: string;
  /** The one paragraph: what goes, and that it does not come back. */
  readonly body: string;
  /** The field's label: "Type Quinn to confirm". */
  readonly label: string;
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

export function deleteMateWords(input: {
  /** The Mate's name. */
  readonly name: string;
  /** Its environment's name: the Zerops project it lives in. */
  readonly environment: string;
  /** Every service that goes with it (`deleteMateServiceCount`); `undefined` while unread. */
  readonly services: number | undefined;
  /** Whose Mate it is, where that is a colleague — "Ada's Mate", as its row says it. */
  readonly owner: string | undefined;
}): DeleteMateWords {
  const { name, environment, owner } = input;
  const whose = owner === undefined ? "" : `${name} is ${owner}'s Mate. `;
  return {
    title: `Delete ${name}?`,
    body:
      `${whose}The environment ${environment} goes from Zerops ${whatGoesWithIt(input.services)}, ` +
      `and ${name}'s conversations go with it. Anything ${name} hasn't pushed is lost. ` +
      "This can't be undone.",
    label: `Type ${name} to confirm`,
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
 * Whether a Mate's menu offers *Delete*: on a Mate — never a stage, a production or the account's
 * Gitea project (`hasMate`) — the viewer may delete (`resolveMateVerbs`' `delete`), and not on
 * one already going: the platform deleting it, or this tab waiting for the listing to let it go.
 * A project the platform failed to create is its row's *Remove*, not this.
 */
export function deleteMateOffered(input: {
  readonly candidate: ZeropsCandidate;
  readonly mayDelete: boolean;
  /** This tab asked the platform to delete it and the listing still holds it. */
  readonly deleting: boolean;
}): boolean {
  const { candidate } = input;
  return (
    input.mayDelete &&
    !input.deleting &&
    hasMate(candidate) &&
    candidate.creationFailed === undefined &&
    !PROJECT_GOING_STATUSES.has(candidate.project.status)
  );
}

/** The platform's words for a project on its way off Zerops. */
export const PROJECT_GOING_STATUSES: ReadonlySet<string> = new Set(["DELETING", "DELETED"]);

/** Where the viewer stands once the platform took the Mate. */
export type DeleteLanding =
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
