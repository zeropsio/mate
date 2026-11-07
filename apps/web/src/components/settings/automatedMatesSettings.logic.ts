/**
 * What Settings › Zerops › HQ says of automated Mates: the organization's API key — set or not,
 * never its value — and, per application, where its automated Mates take tasks from.
 */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqAiKeyView, HqIntakeView } from "@t3tools/shared/hqIntake";
import type { HqNavigationIntake } from "@t3tools/shared/hqStream";

import { type NameOf, sealedWords } from "./automationSettings.logic";

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

/** The key's line: who set it and when, or that it is not set. */
export function aiKeyLine(
  view: Pick<HqAiKeyView, "set" | "setAt" | "setBy"> | undefined,
  day: (iso: string) => string,
  nameOf: NameOf,
): string {
  if (view === undefined || !view.set) return "Not set";
  return `Set${sealedWords(view.setBy, view.setAt, nameOf, day)}`;
}

/** Where an application's automated Mates take tasks from, in a line. */
export function intakeLine(intake: Pick<HqNavigationIntake, "repo" | "label" | "public">): string {
  const line = `Takes issues labelled “${intake.label}” from ${intake.repo}`;
  return intake.public === true ? `${line}, a public repository` : line;
}

/**
 * What HQ answered as the intake was set: the webhook it made, that the organization's GitHub app
 * (`app`, its name where read) tells Mate with nothing to paste, or what to paste.
 */
export function intakeAnswerLine(answer: HqIntakeView, app?: string): string {
  switch (answer.hook.kind) {
    case "made":
      return `Webhook made on ${answer.repo}`;
    case "app":
      return `Takes issues labelled “${answer.label}” from ${answer.repo} — GitHub tells Mate through ${app ?? "your organization's GitHub app"}.`;
    case "paste":
      return `Add this webhook to ${answer.repo}, in its settings › Webhooks. The secret is shown once.`;
  }
}
