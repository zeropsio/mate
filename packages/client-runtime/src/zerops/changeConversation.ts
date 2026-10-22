/**
 * What is said on a change, and what saying it can set in motion.
 *
 * A change's page used to be a fact sheet: it reported checks and merge state
 * and offered nothing to do about either ("the interface is poor, no buttons,
 * no comments, no passing actions to agent" — the owner, 2026-09-19). Three
 * things are missing from a read-only page, and all three are the same seam:
 * somebody says something, and either the change keeps it or a Mate acts on it.
 *
 * HQ keeps a change's conversation (SPEC §3.2a): what people said on it, each
 * comment by the Zerops user who wrote it, who is named as the organization's
 * members name them — never by an id. A Mate's words on main's Gitea, brought
 * over (T13), are the Mate's, named as the application names it. Words said on the change's pull
 * request on GitHub are their GitHub login's, linked to them there.
 *
 * Pure: who said it, what the sentence handed to a Mate says, and nothing
 * about how any of it is drawn (R5).
 */

import type { HqChangeComment } from "@t3tools/shared/hqChanges";

/** One turn in a change's conversation, named rather than logged-in-as. */
export interface ChangeRemark {
  readonly id: string;
  readonly speaker: string;
  /** Where the speaker is, linked: a GitHub user's profile, for words said on GitHub. */
  readonly url?: string;
  /** `true` where the speaker is the person reading — their own words. */
  readonly mine: boolean;
  readonly body: string;
  readonly at: string;
}

/** The conversation as a surface shows it: oldest first, as HQ keeps it. */
export function changeRemarks(input: {
  readonly comments: ReadonlyArray<HqChangeComment>;
  /** The name a Zerops user goes by in the organization, where a member is them. */
  readonly nameOf: (userId: string) => string | undefined;
  /** The name of the application's Mate in that project, for its words brought over from Gitea. */
  readonly mateNameOf: (projectId: string) => string | undefined;
  /** The Zerops user reading, so their own words can be marked. */
  readonly me: string | undefined;
}): ReadonlyArray<ChangeRemark> {
  const nameOf = (comment: HqChangeComment): string | undefined => {
    if (comment.authorUserId !== null) return input.nameOf(comment.authorUserId);
    if (comment.authorMateProjectId !== null) return input.mateNameOf(comment.authorMateProjectId);
    return undefined;
  };
  return input.comments.map((comment) => {
    const login = comment.authorGithubLogin;
    // Said on the change's pull request on GitHub: its GitHub login, linked to them there.
    if (
      login !== undefined &&
      comment.authorUserId === null &&
      comment.authorMateProjectId === null
    )
      return {
        id: comment.id,
        speaker: `${login} on GitHub`,
        url: `https://github.com/${encodeURIComponent(login)}`,
        mine: false,
        body: comment.body,
        at: comment.createdAt,
      };
    return {
      id: comment.id,
      speaker: nameOf(comment) ?? "somebody",
      mine: comment.authorUserId === input.me,
      body: comment.body,
      at: comment.createdAt,
    };
  });
}

/** `Nothing said yet` / `1 comment` / `4 comments` — the section's own count. */
export function changeConversationCount(remarks: ReadonlyArray<ChangeRemark>): string {
  if (remarks.length === 0) return "Nothing said yet";
  return remarks.length === 1 ? "1 comment" : `${String(remarks.length)} comments`;
}

/**
 * The sentence a Mate is handed when somebody asks it for something on a
 * change's review.
 *
 * It names the change the way the forge does, because the Mate's tools address
 * it by number, and it quotes the person's own words rather than paraphrasing
 * them. Asking takes words: an empty box once handed "the whole change" over,
 * which took a line of explanation under the box to be understood.
 */
export function changeAskPrompt(input: {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  /** What the person wrote. */
  readonly said: string;
}): string {
  const change = `#${String(input.number)} "${input.title}" on ${input.repository}`;
  return `On ${change}:\n\n${input.said.trim()}\n\nDo that, then push.`;
}

/**
 * The words a Mate is sent once a person hands it a change whose own Mate is gone: HQ took the
 * branch's rights from the gone Mate and gave them to this one, which carries the work on there.
 */
export function changeHandedPrompt(input: {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  /** The branch it is on, where HQ said. */
  readonly branch: string | undefined;
}): string {
  const change = `#${String(input.number)} "${input.title}" on ${input.repository}`;
  const branch = input.branch === undefined ? "its branch" : `branch ${input.branch}`;
  return `Change ${change} is yours now: its Mate is gone. Its work so far is on ${branch} in HQ. Fetch that branch, carry the change on there, and push to it.`;
}

/** What the *Ask* button says, named after the Mate where there is one. */
export function changeAskLabel(mateName: string | undefined): string {
  return mateName === undefined ? "Ask the Mate" : `Ask ${mateName}`;
}
