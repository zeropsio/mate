/**
 * What Settings › Zerops › HQ says of automated Mates: the organization's API key — set or not,
 * never its value — and, per application, where its automated Mates take tasks from.
 */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqAiKeyView, HqIntakeView } from "@t3tools/shared/hqIntake";
import type { HqNavigationIntake } from "@t3tools/shared/hqStream";

/** `owner/name` of a GitHub repository's address; null for any other host. */
export function githubRepoOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== "github.com") return null;
  const [owner, name] = parsed.pathname
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "")
    .split("/");
  return owner === undefined || name === undefined || owner === "" || name === ""
    ? null
    : `${owner}/${name}`;
}

/** The application's repositories mirrored to GitHub, as tasks can come from them: by `owner/name`. */
export function intakeRepoChoices(
  repos: ReadonlyArray<Pick<RepoListEntry, "name" | "remote">> | undefined,
): ReadonlyArray<string> {
  const choices = new Set<string>();
  for (const repo of repos ?? []) {
    const github = repo.remote == null ? null : githubRepoOf(repo.remote.url);
    if (github !== null) choices.add(github);
  }
  return [...choices];
}

/** The key's line: when it was set, or that it is not. */
export function aiKeyLine(
  view: Pick<HqAiKeyView, "set" | "setAt"> | undefined,
  day: (iso: string) => string,
): string {
  if (view === undefined || !view.set) return "Not set";
  return view.setAt === null ? "Set" : `Set on ${day(view.setAt)}`;
}

/** Where an application's automated Mates take tasks from, in a line. */
export function intakeLine(intake: Pick<HqNavigationIntake, "repo" | "label" | "public">): string {
  const line = `Takes issues labelled “${intake.label}” from ${intake.repo}`;
  return intake.public === true ? `${line}, a public repository` : line;
}

/** What HQ answered as the intake was set: the webhook it made, or what to paste. */
export function intakeAnswerLine(answer: HqIntakeView): string {
  return answer.hook.kind === "made"
    ? `Webhook made on ${answer.repo}`
    : `Add this webhook to ${answer.repo}, in its settings › Webhooks. The secret is shown once.`;
}
