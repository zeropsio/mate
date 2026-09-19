/**
 * What is said on a change, and what saying it can set in motion.
 *
 * A change's page used to be a fact sheet: it reported checks and merge state
 * and offered nothing to do about either ("the interface is poor, no buttons,
 * no comments, no passing actions to agent" — the owner, 2026-09-19). Three
 * things are missing from a read-only page, and all three are the same seam:
 * somebody says something, and either the forge or a Mate acts on it.
 *
 * Gitea keeps a pull request's conversation on the issue of the same number,
 * so a comment here is an issue comment. A Mate writes under its bot login
 * (`mate-{projectId}`) and must be named, never shown as `mate-abc123` — a
 * conversation where half the speakers are machine identifiers is not one.
 *
 * Pure: who said it, what the sentence handed to a Mate says, and nothing
 * about how any of it is drawn (R5).
 */

import type { GiteaIssueComment } from "./giteaClient.ts";
import { mateProjectOfLogin } from "./projectFlow.ts";

/** One turn in a change's conversation, named rather than logged-in-as. */
export interface ChangeRemark {
  readonly id: number;
  /** The Mate's name for a Mate's, the login for a person's. */
  readonly speaker: string;
  /** The Mate's project behind a bot login; `undefined` for a person's. */
  readonly mateProjectId: string | undefined;
  /** `true` where the speaker is the person reading — their own words. */
  readonly mine: boolean;
  readonly body: string;
  readonly at: string | undefined;
}

/**
 * The conversation as a surface shows it: oldest first, empty bodies dropped.
 *
 * Gitea writes a comment for events that are not remarks — a merge, a review
 * with no words — and those arrive with nothing in `body`. A blank bubble is
 * noise, so they never reach the page.
 */
export function changeRemarks(input: {
  readonly comments: ReadonlyArray<GiteaIssueComment>;
  /** `projectId → the Mate's name`, as the flow knows them. */
  readonly mateNames: ReadonlyMap<string, string>;
  /** The login of whoever is reading, so their own words can be marked. */
  readonly me: string | undefined;
}): ReadonlyArray<ChangeRemark> {
  const remarks: Array<ChangeRemark> = [];
  for (const comment of input.comments) {
    const body = comment.body.trim();
    if (body.length === 0) continue;
    const mateProjectId = mateProjectOfLogin(comment.author);
    const named = mateProjectId === undefined ? undefined : input.mateNames.get(mateProjectId);
    remarks.push({
      id: comment.id,
      speaker: named ?? comment.author ?? "somebody",
      mateProjectId,
      mine: input.me !== undefined && comment.author !== undefined && comment.author === input.me,
      body,
      at: comment.at,
    });
  }
  return remarks;
}

/** `Nothing said yet` / `1 comment` / `4 comments` — the section's own count. */
export function changeConversationCount(remarks: ReadonlyArray<ChangeRemark>): string {
  if (remarks.length === 0) return "Nothing said yet";
  return remarks.length === 1 ? "1 comment" : `${String(remarks.length)} comments`;
}

/**
 * The sentence a Mate is handed when somebody passes it something from a
 * change's page.
 *
 * It names the change the way the forge does, because the Mate's tools address
 * it by number, and it quotes the person's own words rather than paraphrasing
 * them. It stops at composing — the person presses send, as everywhere a
 * prompt is prefilled (spec §5.4).
 */
export function changeAskPrompt(input: {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  /** What the person wrote; blank asks the Mate to take the change forward. */
  readonly said: string;
}): string {
  const change = `#${String(input.number)} "${input.title}" on ${input.repository}`;
  const said = input.said.trim();
  if (said.length === 0) {
    return `Take ${change} forward: read it, do what it still needs, and push.`;
  }
  return `On ${change}:\n\n${said}\n\nDo that, then push.`;
}

/** What the *Ask* button says, named after the Mate where there is one. */
export function changeAskLabel(mateName: string | undefined): string {
  return mateName === undefined ? "Ask the Mate" : `Ask ${mateName}`;
}
