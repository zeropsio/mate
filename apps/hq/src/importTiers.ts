/**
 * A recipe tier brought from main, rewritten to build from HQ (T13): main's tiers name each
 * runtime's repository on the group's Gitea, and HQ deploys only a runtime built from its own
 * address of the application's repository (`tierRuntimes.ts`). Line by line, so every comment and
 * every other line stays as main wrote it. Migration-only: it goes with T14.
 *
 * Only a `buildFromGit` naming one of the application's own repositories on its Gitea — the host
 * and the org the bundle names, a repository the bundle brings — moves. Every other mention of
 * Gitea, another org's repository or one the bundle lacks, and a build from a host that is neither
 * Gitea's nor a public one, stays as it is and is said, by line.
 *
 * @module importTiers
 */
import { isPublicBuild } from "./recipeDeltas.ts";

export interface TierRewrite {
  readonly content: string;
  /** The lines that moved, counted from 1. */
  readonly rewritten: ReadonlyArray<number>;
  /** What stays and why, each with its line. */
  readonly notes: ReadonlyArray<string>;
}

const BUILD = /^(\s*(?:-\s+)?buildFromGit:\s*)(["']?)([^\s"'#]+)\2(.*)$/u;

export const rewriteTier = (
  content: string,
  at: {
    /** Gitea's host, as main's tiers name it. */
    readonly host: string;
    /** The application's org on that Gitea. */
    readonly owner: string;
    /** The repositories the bundle brings for the application. */
    readonly repos: ReadonlyArray<string>;
    /** HQ's address of the repository `repo`. */
    readonly to: (repo: string) => string;
  },
): TierRewrite => {
  const rewritten: Array<number> = [];
  const notes: Array<string> = [];
  const lines = content.split("\n").map((line, index) => {
    const number = index + 1;
    const build = BUILD.exec(line);
    if (build === null) {
      if (line.includes(at.host) || /gitea/iu.test(line))
        notes.push(`line ${String(number)} names Gitea`);
      return line;
    }
    const [, lead = "", quote = "", address = "", rest = ""] = build;
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      notes.push(`line ${String(number)} builds from no address HQ reads`);
      return line;
    }
    if (url.host !== at.host) {
      if (!isPublicBuild(address)) {
        notes.push(
          `line ${String(number)} builds from ${url.host}, neither Gitea's nor a public host`,
        );
      }
      return line;
    }
    const segments = url.pathname
      .replace(/\/+$/u, "")
      .replace(/\.git$/u, "")
      .split("/")
      .filter((segment) => segment !== "");
    const [owner = "", repo = ""] = segments;
    if (segments.length !== 2) {
      notes.push(`line ${String(number)} names Gitea`);
      return line;
    }
    if (owner !== at.owner) {
      notes.push(
        `line ${String(number)} builds from ${owner}/${repo} on Gitea, no repository of this application's`,
      );
      return line;
    }
    if (!at.repos.includes(repo)) {
      notes.push(
        `line ${String(number)} builds from ${owner}/${repo} on Gitea, which the bundle does not bring`,
      );
      return line;
    }
    rewritten.push(number);
    return `${lead}${quote}${at.to(repo)}${quote}${rest}`;
  });
  return { content: lines.join("\n"), rewritten, notes };
};
