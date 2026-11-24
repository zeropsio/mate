#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- release driver over git and CI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";
import { ciRefusal, type WorkflowJob, type WorkflowRun } from "./ci-blame.ts";
import { buildGateGraph, stageInputSets } from "./gate-changed.ts";
import { nextVersion, parseVersion } from "./release-mate.ts";

const repository = "zeropsio/mate";
const gh = process.env.MATE_GH || "gh";
const options = NodeUtil.parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    "from-sha": { type: "string" },
    minor: { type: "boolean" },
  },
}).values;

const root = NodeChildProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const common = NodeChildProcess.execFileSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { cwd: root, encoding: "utf8" },
).trim();

// Fetch only into a temporary object store: a dry run leaves the checkout and its refs unchanged.
const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-web-release-"));
const objects = NodePath.join(temporary, "objects");
NodeFS.mkdirSync(NodePath.join(objects, "pack"), { recursive: true });
NodeFS.mkdirSync(NodePath.join(objects, "info"));
const env = {
  ...process.env,
  GIT_OBJECT_DIRECTORY: objects,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: [
    NodePath.join(common, "objects"),
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES,
  ]
    .filter(Boolean)
    .join(NodePath.delimiter),
};
const git = (...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

const isAncestor = (ancestor: string, descendant: string) => {
  const result = NodeChildProcess.spawnSync(
    "git",
    ["merge-base", "--is-ancestor", ancestor, descendant],
    {
      cwd: root,
      env,
      encoding: "utf8",
    },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw result.error ?? new Error(result.stderr || "git merge-base failed");
};

type WebTag = {
  name: string;
  commit: string;
  version: NonNullable<ReturnType<typeof parseVersion>>;
};

function remote(): { main: string; tags: WebTag[] } {
  let main: string | undefined;
  const commits = new Map<string, string>();
  for (const line of git("ls-remote", "origin", "refs/heads/main", "refs/tags/web-v*").split(
    "\n",
  )) {
    const [sha, ref] = line.split("\t");
    if (ref === "refs/heads/main") main = sha;
    const match = /^refs\/tags\/(web-v\d+\.\d+\.\d+)(\^\{\})?$/u.exec(ref ?? "");
    // Annotated tags have a peeled commit after their tag object.
    if (sha && match && (match[2] || !commits.has(match[1]!))) commits.set(match[1]!, sha);
  }
  if (!main) throw new Error("origin has no main branch");
  const tags = [...commits].map(([name, commit]) => ({
    name,
    commit,
    version: parseVersion(name.slice("web-v".length))!,
  }));
  tags.sort(
    (a, b) =>
      a.version[0] - b.version[0] || a.version[1] - b.version[1] || a.version[2] - b.version[2],
  );
  // The remote owns the tags. Fetching by object id does not update local refs or FETCH_HEAD.
  git(
    "fetch",
    "--quiet",
    "--no-tags",
    "--no-write-fetch-head",
    "origin",
    main,
    ...tags.map((tag) => tag.commit),
  );
  return { main, tags };
}

function releasedBy(source: string, tags: WebTag[]): WebTag | undefined {
  return tags.toReversed().find((tag) => isAncestor(source, tag.commit));
}

function webInputs(ref: string, paths: string[], label: string): ReadonlySet<string> {
  const tree = NodePath.join(temporary, label);
  const archive = NodePath.join(temporary, `${label}.tar`);
  NodeFS.mkdirSync(tree);
  git("archive", "--format=tar", `--output=${archive}`, ref);
  NodeChildProcess.execFileSync("tar", ["-xf", archive, "-C", tree]);
  const inventory = git("ls-tree", "-r", "--name-only", "-z", ref).split("\0").filter(Boolean);
  const graph = buildGateGraph(tree, new Map(), paths);
  const inputs = stageInputSets(tree, [...inventory, ...paths], graph).get("build web client");
  if (!inputs) throw new Error("the gate has no build web client input set");
  return inputs;
}

function main(): void {
  // The server release holds this same SQLite transaction in the shared git common directory.
  let lock: NodeSqlite.DatabaseSync | undefined;
  if (!options["dry-run"]) {
    const path = NodePath.join(common, "mate-release.lock");
    lock = new NodeSqlite.DatabaseSync(path);
    try {
      lock.exec("BEGIN IMMEDIATE");
    } catch (error) {
      lock.close();
      if ((error as { errcode?: unknown }).errcode === 5)
        throw new Error(`another release holds ${path}; nothing cut`, { cause: error });
      throw error;
    }
  }
  try {
    const { main: mainHead, tags } = remote();
    const source = options["from-sha"] ?? mainHead;
    if (!/^[0-9a-f]{40}$/u.test(source)) throw new Error("--from-sha requires a full commit SHA");
    if (!isAncestor(source, mainHead)) throw new Error(`source ${source} is not on origin/main`);
    const released = releasedBy(source, tags);
    if (released) {
      console.log(`already released: ${released.name} includes source ${source}`);
      return;
    }

    const api = <T>(endpoint: string, jq?: string): T =>
      JSON.parse(
        NodeChildProcess.execFileSync(gh, ["api", endpoint, ...(jq ? ["--jq", jq] : [])], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
        }),
      ) as T;
    const runs = api<{ workflow_runs: WorkflowRun[] }>(
      `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${source}&branch=main&per_page=10`,
    );
    const refusal = ciRefusal(runs.workflow_runs, source, (run) =>
      api<WorkflowJob[]>(
        `repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`,
        "[.jobs[] | {name, conclusion}]",
      ),
    );
    if (refusal) throw new Error(refusal);

    const latest = tags.at(-1);
    if (latest) {
      if (!isAncestor(latest.commit, source))
        throw new Error(`latest web release ${latest.name} is not an ancestor of ${source}`);
      const paths = git("diff", "--name-only", "--no-renames", "-z", latest.commit, source, "--")
        .split("\0")
        .filter(Boolean);
      if (paths.length === 0) {
        console.log(`nothing to release: no web build input changed since ${latest.name}`);
        return;
      }
      const previousInputs = webInputs(latest.commit, paths, "previous");
      const sourceInputs = webInputs(source, paths, "source");
      if (!paths.some((path) => previousInputs.has(path) || sourceInputs.has(path))) {
        console.log(`nothing to release: no web build input changed since ${latest.name}`);
        return;
      }
    }

    const version = latest
      ? nextVersion(latest.version.join("."), undefined, options.minor ? "minor" : "patch")
      : "0.1.0";
    const tag = `web-v${version}`;
    if (options["dry-run"]) {
      console.log(`would tag ${tag} at ${source}`);
      return;
    }

    // Another clone may release first. Git's tag push decides the race between clones.
    const raced = releasedBy(source, remote().tags);
    if (raced) {
      console.log(`already released: ${raced.name} includes source ${source}`);
      return;
    }
    try {
      git("push", "--quiet", "origin", `${source}:refs/tags/${tag}`);
    } catch (error) {
      const winner = releasedBy(source, remote().tags);
      if (!winner) throw error;
      console.log(`already released: ${winner.name} includes source ${source}`);
      return;
    }
    console.log(`RELEASED ${tag} ${source}`);
  } finally {
    lock?.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  NodeFS.rmSync(temporary, { recursive: true, force: true });
}
