#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off globalTimers:off globalDate:off - a release driver over git and the published manifest.
/**
 * Cuts a mate release from `origin/main` in one command. In a throwaway worktree it bumps the three
 * package versions, commits `chore(release): mate X.Y.Z` naming what was merged since the last
 * release, pushes `main`, pushes exactly that tag, then waits until
 * `releases/latest/download/stable.json` serves the new version with the checksum the release's
 * `SHA256SUMS` lists.
 *
 *   node scripts/release-mate.ts            a patch release
 *   node scripts/release-mate.ts --minor    the client's compatibility floor rises
 *   node scripts/release-mate.ts --dry-run  print the plan, change nothing
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/** The release workflow checks server == desktop and tag == server; web moves with them. */
export const VERSIONED_PACKAGES = [
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
] as const;

const REPOSITORY = "zeropsio/mate";

type Version = readonly [number, number, number];

export function parseVersion(text: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const formatVersion = (version: Version) => version.join(".");

/** The highest `vX.Y.Z` in `git ls-remote --tags` output; peeled `^{}` refs and other names don't count. */
export function highestTag(lsRemote: string): string | undefined {
  const versions = lsRemote.split("\n").flatMap((line) => {
    const tag = /\trefs\/tags\/(v\d+\.\d+\.\d+)$/.exec(line)?.[1];
    const version = tag === undefined ? undefined : parseVersion(tag);
    return version ? [version] : [];
  });
  const highest = versions.toSorted(compare).at(-1);
  return highest ? formatVersion(highest) : undefined;
}

/** The version after both the packages' own and the highest published tag. */
export function nextVersion(
  packages: string,
  published: string | undefined,
  bump: "patch" | "minor",
): string {
  const own = parseVersion(packages);
  if (!own) throw new Error(`not a release version: ${packages}`);
  const tag = published === undefined ? undefined : parseVersion(published);
  const base = tag && compare(tag, own) > 0 ? tag : own;
  return formatVersion(
    bump === "minor" ? [base[0], base[1] + 1, 0] : [base[0], base[1], base[2] + 1],
  );
}

/** The manifest with its one `"version": "<from>"` set to `to`; any other count is an error. */
export function bumpVersion(json: string, from: string, to: string): string {
  const line = `"version": "${from}"`;
  const count = json.split(line).length - 1;
  if (count !== 1) throw new Error(`expected one ${line}, found ${count}`);
  return json.replace(line, `"version": "${to}"`);
}

/** The first-parent log format `releaseNotes` reads: a record per commit, subject then body. */
export const NOTES_LOG_FORMAT = "%x1e%s%x1f%b";

/** One line per first-parent commit: a merged PR as its number and title, a pushed commit as its subject. */
export function releaseNotes(log: string): string {
  return log
    .split("\x1e")
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [subject = "", body = ""] = record.split("\x1f");
      const merge = /^Merge pull request #(\d+) from (\S+)/.exec(subject);
      const title = body.trim().split("\n")[0]?.trim();
      return merge ? `- #${merge[1]} ${title || merge[2]}` : `- ${subject.trim()}`;
    })
    .join("\n");
}

/** Release automation carries the same lane identity as the change it ships. */
export function releaseMessage(version: string, notes: string, card?: string): string {
  return `chore(release): mate ${version}\n\n${notes}${card?.trim() ? `\n\nCard: ${card.trim()}` : ""}`;
}

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

interface Manifest {
  readonly version?: string;
  readonly asset?: string;
  readonly sha256?: string;
}

async function waitForManifest(version: string): Promise<void> {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const manifest = await fetch(
      `https://github.com/${REPOSITORY}/releases/latest/download/stable.json`,
      { cache: "no-store" },
    )
      .then((response) => (response.ok ? (response.json() as Promise<Manifest>) : undefined))
      .catch(() => undefined);
    if (manifest?.version === version) {
      const sums = await fetch(
        `https://github.com/${REPOSITORY}/releases/download/v${version}/SHA256SUMS`,
      ).then((response) => response.text());
      const listed = sums
        .split("\n")
        .find((line) => manifest.asset !== undefined && line.trim().endsWith(manifest.asset))
        ?.split(/\s+/)[0];
      if (listed === undefined || listed !== manifest.sha256) {
        throw new Error(
          `stable.json's sha256 ${manifest.sha256} is not the ${listed} SHA256SUMS lists`,
        );
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(
    `stable.json did not serve ${version} in 20 minutes: https://github.com/${REPOSITORY}/actions`,
  );
}

async function main(args: ReadonlySet<string>): Promise<void> {
  const repo = git(process.cwd(), "rev-parse", "--show-toplevel");
  git(repo, "fetch", "--quiet", "origin", "main");
  // A throwaway tree: the release never touches a checkout someone is working in.
  const tree = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-release-"));
  git(repo, "worktree", "add", "--quiet", "--detach", tree, "origin/main");
  try {
    const versions = VERSIONED_PACKAGES.map(
      (file) =>
        (JSON.parse(NodeFS.readFileSync(NodePath.join(tree, file), "utf8")) as { version: string })
          .version,
    );
    const current = versions[0]!;
    if (versions.some((version) => version !== current)) {
      throw new Error(`the three versions differ: ${versions.join(", ")}`);
    }
    const published = highestTag(git(tree, "ls-remote", "--tags", "origin", "refs/tags/v*"));
    const next = nextVersion(current, published, args.has("--minor") ? "minor" : "patch");
    const lastRelease = git(
      tree,
      "log",
      "--first-parent",
      "-1",
      "--format=%H",
      "--grep=^chore(release): mate ",
    );
    const range = lastRelease === "" ? "HEAD" : `${lastRelease}..HEAD`;
    const notes = releaseNotes(
      git(tree, "log", "--first-parent", "--reverse", `--format=${NOTES_LOG_FORMAT}`, range),
    );
    if (notes === "")
      throw new Error(`nothing reached main since the last release ${lastRelease.slice(0, 9)}`);
    const message = releaseMessage(next, notes, process.env.BOARD_CARD);
    console.log(`${current} → ${next} (published: ${published ?? "none"})\n\n${message}\n`);
    if (args.has("--dry-run")) return;

    for (const file of VERSIONED_PACKAGES) {
      const path = NodePath.join(tree, file);
      NodeFS.writeFileSync(path, bumpVersion(NodeFS.readFileSync(path, "utf8"), current, next));
    }
    git(tree, "add", ...VERSIONED_PACKAGES);
    // The release worktree shares installed tooling so the normal commit hooks can run.
    NodeFS.symlinkSync(
      NodePath.join(repo, "node_modules"),
      NodePath.join(tree, "node_modules"),
      "dir",
    );
    git(tree, "commit", "--quiet", "-m", message);
    // A fast-forward only: if main moved since the fetch, this fails and nothing is tagged.
    git(tree, "push", "--quiet", "origin", "HEAD:main");
    git(tree, "tag", "-a", `v${next}`, "-m", `mate ${next}`);
    // Exactly this tag: the fork holds upstream's tags, which origin must never receive.
    git(tree, "push", "--quiet", "origin", `refs/tags/v${next}`);
    console.log(`pushed main and v${next}; waiting for stable.json to serve it…`);
    await waitForManifest(next);
    console.log(`released: stable.json serves ${next}, its sha256 matches SHA256SUMS`);
  } finally {
    git(repo, "worktree", "remove", "--force", tree);
  }
}

if (import.meta.main) {
  main(new Set(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
