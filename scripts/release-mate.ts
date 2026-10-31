#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalFetch:off globalTimers:off globalDate:off - a release driver over git and the published manifest.
/**
 * Cuts a mate release from a pinned green main SHA. In a throwaway worktree it bumps the three
 * package versions, commits `chore(release): mate X.Y.Z` naming what was merged since the last
 * release, pushes only that tag, then waits for CI and bundle verification before
 * `releases/latest/download/stable.json` serves the new version with the checksum the release's
 * `SHA256SUMS` lists.
 *
 *   node scripts/release-mate.ts --from-sha S  release a green source commit
 *   node scripts/release-mate.ts --minor    the client's compatibility floor rises
 *   node scripts/release-mate.ts --dry-run  print the plan, change nothing
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { readReleaseSource, VERSIONED_RELEASE_PACKAGES } from "@t3tools/shared/releaseSource";

/** The release workflow checks server == desktop and tag == server; web moves with them. */
export const VERSIONED_PACKAGES = VERSIONED_RELEASE_PACKAGES;

const REPOSITORY = "zeropsio/mate";
// GitHub CLI for API calls; a maintainer may point MATE_GH at a wrapper holding the release token.
const GH = process.env.MATE_GH || "gh";

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

export function releaseMessage(version: string, notes: string): string {
  return `chore(release): mate ${version}\n\n${notes}`;
}

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

interface PublishedRelease {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
}

// `jq` keeps only the fields read here: a full page of releases outgrows execFileSync's buffer.
const github = <T>(repo: string, endpoint: string, jq?: string): T =>
  JSON.parse(
    NodeChildProcess.execFileSync(GH, ["api", endpoint, ...(jq ? ["--jq", jq] : [])], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  ) as T;

const sourceOf = (repo: string, ref: string) => {
  const source = Effect.runSync(
    readReleaseSource(git(repo, "rev-parse", `${ref}^{commit}`), (args) =>
      Effect.sync(() => ({ output: git(repo, ...args), code: 0 })),
    ),
  );
  if (source === undefined) throw new Error(`release ${ref} is not a version-only commit`);
  return source;
};

interface WorkflowRun {
  readonly head_sha: string;
  readonly head_branch: string;
  readonly status: string;
  readonly conclusion: string | null;
}

export function greenSource(runs: ReadonlyArray<WorkflowRun>, sha: string): boolean {
  const latest = runs.find((run) => run.head_sha === sha && run.head_branch === "main");
  return latest?.status === "completed" && latest.conclusion === "success";
}

interface Manifest {
  readonly version?: string;
  readonly asset?: string;
  readonly sha256?: string;
}

interface ReleaseWorkflowRun extends WorkflowRun {
  readonly id: number;
  readonly run_attempt: number;
  readonly html_url: string;
}

async function waitForManifest(repo: string, version: string, releaseSHA: string): Promise<void> {
  const deadline = Date.now() + 45 * 60_000;
  let retried: ReleaseWorkflowRun | undefined;
  while (Date.now() < deadline) {
    const runs = github<{ workflow_runs: ReleaseWorkflowRun[] }>(
      repo,
      `repos/${REPOSITORY}/actions/workflows/release.yml/runs?head_sha=${releaseSHA}&per_page=10`,
    ).workflow_runs;
    const run = runs.find((run) => run.head_sha === releaseSHA);
    // GitHub can return the completed old attempt after accepting the rerun.
    if (retried && run?.id === retried.id && run.run_attempt <= retried.run_attempt) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    if (run?.status === "completed" && run.conclusion !== "success") {
      const failure = `release CI failed for ${releaseSHA}: ${run.conclusion}; ${run.html_url ?? `https://github.com/${REPOSITORY}/actions`}, attempt ${run.run_attempt ?? "unknown"}`;
      if (retried || !Number.isInteger(run.id) || !Number.isInteger(run.run_attempt))
        throw new Error(`${failure}; nothing published`);
      console.log(`${failure}; retrying the same release workflow once`);
      try {
        NodeChildProcess.execFileSync(
          GH,
          ["api", "--method", "POST", `repos/${REPOSITORY}/actions/runs/${run.id}/rerun`],
          { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (error) {
        throw new Error(`${failure}; could not retry: ${String(error)}`);
      }
      retried = run;
      continue;
    }

    const manifest =
      run?.status === "completed" && run.conclusion === "success"
        ? await fetch(`https://github.com/${REPOSITORY}/releases/latest/download/stable.json`, {
            cache: "no-store",
          })
            .then((response) => (response.ok ? (response.json() as Promise<Manifest>) : undefined))
            .catch(() => undefined)
        : undefined;
    if (
      run?.status === "completed" &&
      run.conclusion === "success" &&
      manifest?.version === version
    ) {
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
    `stable.json did not serve ${version} in 45 minutes: ${retried?.html_url ?? `https://github.com/${REPOSITORY}/actions`}${retried ? `; retry requested after attempt ${retried.run_attempt}: ${retried.conclusion}` : ""}`,
  );
}

async function main(args: ReadonlySet<string>): Promise<void> {
  const repo = git(process.cwd(), "rev-parse", "--show-toplevel");
  git(repo, "fetch", "--quiet", "origin", "main", "--tags");
  const mainHead = git(repo, "rev-parse", "origin/main");
  const expected = [...args]
    .find((arg) => arg.startsWith("--expected-sha="))
    ?.slice("--expected-sha=".length);
  if (expected !== undefined && expected !== mainHead) {
    throw new Error(
      `origin/main moved after CI approval: expected ${expected}, fetched ${mainHead}`,
    );
  }
  const argv = [...args];
  const fromIndex = argv.indexOf("--from-sha");
  const source =
    argv.find((arg) => arg.startsWith("--from-sha="))?.slice("--from-sha=".length) ??
    (fromIndex >= 0 ? argv[fromIndex + 1] : mainHead);
  if (source === undefined || !/^[0-9a-f]{40}$/.test(source))
    throw new Error("--from-sha requires a full commit SHA");
  git(repo, "merge-base", "--is-ancestor", source, mainHead);
  const runs = github<{ workflow_runs: WorkflowRun[] }>(
    repo,
    `repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${source}&branch=main&per_page=10`,
  );
  if (!greenSource(runs.workflow_runs, source))
    throw new Error(`source ${source} has no green main CI`);
  const releases: PublishedRelease[] = [];
  for (let page = 1; ; page++) {
    const batch = github<PublishedRelease[]>(
      repo,
      `repos/${REPOSITORY}/releases?per_page=100&page=${page}`,
      "[.[] | {tag_name, draft, prerelease}]",
    );
    releases.push(
      ...batch.filter(
        (release) =>
          !release.draft && !release.prerelease && parseVersion(release.tag_name) !== undefined,
      ),
    );
    if (batch.length < 100) break;
  }
  const lastTag = releases
    .map((release) => release.tag_name)
    .toSorted((a, b) => compare(parseVersion(a)!, parseVersion(b)!))
    .at(-1);
  const lastSource = lastTag === undefined ? undefined : sourceOf(repo, lastTag);
  if (lastSource === source) {
    if (!args.has("--dry-run"))
      await waitForManifest(
        repo,
        formatVersion(parseVersion(lastTag!)!),
        git(repo, "rev-parse", `${lastTag}^{commit}`),
      );
    console.log(`already released: ${lastTag} includes source ${source}`);
    return;
  }
  if (lastSource !== undefined) git(repo, "merge-base", "--is-ancestor", lastSource, source);
  // A throwaway tree: the release never touches a checkout someone is working in.
  const tree = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-release-"));
  git(repo, "worktree", "add", "--quiet", "--detach", tree, source);
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
    const range = lastSource === undefined ? "HEAD" : `${lastSource}..HEAD`;
    const notes = releaseNotes(
      git(tree, "log", "--first-parent", "--reverse", `--format=${NOTES_LOG_FORMAT}`, range),
    );
    if (notes === "")
      throw new Error(`nothing reached main since the last release ${lastSource?.slice(0, 9)}`);
    const message = releaseMessage(next, notes);
    console.log(
      `source: ${source} (main: ${mainHead}); previous published: ${lastTag ?? "none"}; tag-only release\n${current} → ${next} (published: ${published ?? "none"})\n\n${message}\n`,
    );
    // Historical green commits predate this gate and cannot safely publish detached releases.
    const workflow = NodeFS.readFileSync(
      NodePath.join(tree, ".github/workflows/release.yml"),
      "utf8",
    );
    if (!workflow.includes("  verify:") || !workflow.includes("needs: [build, verify]")) {
      throw new Error(
        `source ${source} predates the release CI publication gate; choose a later green SHA`,
      );
    }
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
    git(tree, "tag", "-a", `v${next}`, "-m", `mate ${next}`);
    // Exactly this tag: the fork holds upstream's tags, which origin must never receive.
    git(tree, "push", "--quiet", "origin", `refs/tags/v${next}`);
    console.log(`pushed only v${next}; waiting for release CI and stable.json…`);
    await waitForManifest(repo, next, git(tree, "rev-parse", "HEAD"));
    console.log(`released: stable.json serves ${next}, its sha256 matches SHA256SUMS`);
  } finally {
    const modules = NodePath.join(tree, "node_modules");
    if (NodeFS.existsSync(modules)) NodeFS.unlinkSync(modules);
    git(tree, "restore", "--staged", "--worktree", ...VERSIONED_PACKAGES);
    git(repo, "worktree", "remove", tree);
  }
}

if (import.meta.main) {
  main(new Set(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
