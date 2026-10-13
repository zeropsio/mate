// @effect-diagnostics nodeBuiltinImport:off -- release driver fixture.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { parse } from "yaml";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { describe, expect, it } from "@effect/vitest";

import {
  greenSource,
  bumpVersion,
  highestTag,
  nextVersion,
  parseVersion,
  releaseNotes,
  releaseMessage,
} from "./release-mate.ts";

describe("parseVersion", () => {
  it.each([
    { text: "0.11.69", version: [0, 11, 69] },
    { text: "v1.2.3", version: [1, 2, 3] },
    { text: "0.11.69-rehearsal", version: undefined },
    { text: "nightly", version: undefined },
  ])("$text", ({ text, version }) => {
    expect(parseVersion(text)).toEqual(version);
  });
});

describe("highestTag", () => {
  it.each([
    {
      name: "compares numerically, not as text",
      lsRemote: "a1\trefs/tags/v0.9.4\nb2\trefs/tags/v0.11.68\nc3\trefs/tags/v0.11.9",
      tag: "0.11.68",
    },
    {
      name: "skips peeled refs and names that are no release",
      lsRemote: "a1\trefs/tags/v0.11.68\nb2\trefs/tags/v0.12.0^{}\nc3\trefs/tags/v0.13.0-nightly",
      tag: "0.11.68",
    },
    { name: "nothing published", lsRemote: "", tag: undefined },
  ])("$name", ({ lsRemote, tag }) => {
    expect(highestTag(lsRemote)).toBe(tag);
  });
});

describe("nextVersion", () => {
  it.each([
    { packages: "0.11.69", published: "0.11.69", bump: "patch", next: "0.11.70" },
    { packages: "0.11.69", published: "0.11.69", bump: "minor", next: "0.12.0" },
    // Another session released while this branch was open: the tag is ahead of the packages.
    { packages: "0.11.69", published: "0.11.70", bump: "patch", next: "0.11.71" },
    { packages: "0.11.69", published: undefined, bump: "patch", next: "0.11.70" },
  ] as const)(
    "$packages, published $published, $bump → $next",
    ({ packages, published, bump, next }) => {
      expect(nextVersion(packages, published, bump)).toBe(next);
    },
  );

  it("refuses a version that is no release", () => {
    expect(() => nextVersion("0.0.0-rehearsal", undefined, "patch")).toThrow(
      "not a release version",
    );
  });
});

describe("bumpVersion", () => {
  it("sets the one version line", () => {
    expect(
      bumpVersion('{\n  "name": "web",\n  "version": "0.11.69"\n}\n', "0.11.69", "0.11.70"),
    ).toBe('{\n  "name": "web",\n  "version": "0.11.70"\n}\n');
  });

  it.each([
    { name: "no line holds the version", json: '{ "version": "0.11.68" }', found: 0 },
    {
      name: "two lines hold it",
      json: '{ "version": "0.11.69", "x": { "version": "0.11.69" } }',
      found: 2,
    },
  ])("refuses when $name", ({ json, found }) => {
    expect(() => bumpVersion(json, "0.11.69", "0.11.70")).toThrow(`found ${found}`);
  });
});

describe("releaseNotes", () => {
  it("names each merged pull request by number and title, and a pushed commit by its subject", () => {
    const log = [
      "\x1eMerge pull request #38 from zeropsio/fix/pass-20\x1fPass 20: the Crew tab as approved\n",
      "\x1efix(web): the release lists read every tier's repos\x1f\n",
      "\x1eMerge pull request #39 from zeropsio/fix/pass-21\x1f\n",
    ].join("");
    expect(releaseNotes(log)).toBe(
      [
        "- #38 Pass 20: the Crew tab as approved",
        "- fix(web): the release lists read every tier's repos",
        "- #39 zeropsio/fix/pass-21",
      ].join("\n"),
    );
  });

  it("is empty when nothing reached main", () => {
    expect(releaseNotes("")).toBe("");
  });
});

it("a release commit carries the version and the notes that reached main", () => {
  expect(releaseMessage("0.14.105", "- fix: retain recovery outcomes")).toBe(
    "chore(release): mate 0.14.105\n\n- fix: retain recovery outcomes",
  );
});

// The batch's green CI receipt belongs to one SHA; a subsequent fetch must not replace it.
it.layer(NodeServices.layer)("release approval", (it) => {
  it.effect("a release refuses main that moved after the batch approved CI", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "release-head-" });
        const git = path.join(dir, "git");
        yield* fs.writeFileString(
          git,
          `#!/bin/sh
case "$*" in
 *"rev-parse --show-toplevel"*) echo "$RELEASE_TEST_ROOT";;
 *"fetch "*) exit 0;;
 *"rev-parse origin/main"*) echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;;
 *) echo unexpected-git-command >&2; exit 1;;
esac
`,
        );
        yield* fs.chmod(git, 0o700);
        const child = yield* spawner.spawn(
          ChildProcess.make(
            process.execPath,
            [
              path.join(import.meta.dirname, "release-mate.ts"),
              "--expected-sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "--dry-run",
            ],
            {
              cwd: dir,
              env: {
                ...process.env,
                PATH: `${dir}:${process.env.PATH}`,
                RELEASE_TEST_ROOT: dir,
              },
            },
          ),
        );
        const [status, stderr] = yield* Effect.all(
          [
            child.exitCode,
            child.stderr.pipe(
              Stream.decodeText(),
              Stream.runFold(
                () => "",
                (a, b) => a + b,
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );
        expect(Number(status)).toBe(1);
        expect(
          stderr,
          "ASSERTION: the release must reject a fetched SHA without the batch CI approval",
        ).toContain("origin/main moved after CI approval");
      }),
    ),
  );
});

it.each([
  { status: "completed", conclusion: "success", green: true },
  { status: "completed", conclusion: "failure", green: false },
  { status: "in_progress", conclusion: null, green: false },
])(
  "a pinned source requires its own completed successful main CI: $status $conclusion",
  ({ status, conclusion, green }) => {
    expect(
      greenSource([{ head_sha: "source", head_branch: "main", status, conclusion }], "source"),
    ).toBe(green);
    expect(
      greenSource([{ head_sha: "other", head_branch: "main", status, conclusion }], "source"),
    ).toBe(false);
    expect(
      greenSource([{ head_sha: "source", head_branch: "feature", status, conclusion }], "source"),
    ).toBe(false);
  },
);

it("a failed or pending rerun does not reuse an older green approval", () => {
  expect(
    greenSource(
      [
        { head_sha: "source", head_branch: "main", status: "in_progress", conclusion: null },
        { head_sha: "source", head_branch: "main", status: "completed", conclusion: "success" },
      ],
      "source",
    ),
  ).toBe(false);
});

it("release CI grants the permissions requested by its reusable workflow", () => {
  const workflow = parse(
    NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "../.github/workflows/release.yml"),
      "utf8",
    ),
  );
  expect(
    workflow.jobs.verify.permissions,
    "ASSERTION: release verification needs only read access to prior workflow runs",
  ).toEqual({ contents: "read", actions: "read" });
  expect(
    workflow.jobs.verify.steps.find(
      (step: { name: string }) => step.name === "Check exact-SHA CI verification",
    ).env.GH_TOKEN,
  ).toBe("${{ github.token }}");
  expect(workflow.jobs.verify.uses).toBeUndefined();
});

it("failed release CI publishes no manifest, checksum or latest release", () => {
  const workflow = parse(
    NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "../.github/workflows/release.yml"),
      "utf8",
    ),
  ) as {
    jobs: Record<
      string,
      { needs?: string[]; uses?: string; if?: string; steps?: { run?: string }[] }
    >;
  };
  expect(workflow.jobs.verify).toBeDefined();
  expect(
    workflow.jobs.release?.needs,
    "ASSERTION: publication requires the exact-SHA CI verdict and bundle verification",
  ).toEqual(["build", "verify"]);
  expect(workflow.jobs.release?.if).toBe("github.event_name == 'push'");
  expect(workflow.jobs.release?.steps?.at(-1)?.run).toContain("--latest");
});

it("Decision: orchestrator chose tag-from-green-SHA over a push hold (analysis: a hold needs race-free enforcement across every writer and stalls shipping).", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "release-source-driver-"));
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Release test");
    git("config", "user.email", "release@example.invalid");
    const files = [
      "apps/server/package.json",
      "apps/desktop/package.json",
      "apps/web/package.json",
    ];
    for (const file of files) {
      const path = NodePath.join(root, file);
      NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
      NodeFS.writeFileSync(path, '{"version": "0.15.0"}');
    }
    NodeFS.mkdirSync(NodePath.join(root, ".github/workflows"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, ".github/workflows/release.yml"),
      "  verify:\nneeds: [build, verify]\n",
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "baseline");
    git("tag", "v0.15.0");
    NodeFS.writeFileSync(NodePath.join(root, "product.ts"), "fix");
    git("add", ".");
    git("commit", "--quiet", "-m", "critical fix");
    const source = git("rev-parse", "HEAD");
    NodeFS.writeFileSync(NodePath.join(root, "product.ts"), "main moved");
    git("add", ".");
    git("commit", "--quiet", "-m", "pending main");
    const head = git("rev-parse", "HEAD");
    const remote = NodePath.join(root, "remote.git");
    git("init", "--quiet", "--bare", remote);
    git("remote", "add", "origin", remote);
    git("push", "--quiet", "origin", "main", "v0.15.0");
    const bin = NodePath.join(root, "bin");
    NodeFS.mkdirSync(bin);
    NodeFS.writeFileSync(
      NodePath.join(bin, "gh-mate"),
      `#!/bin/sh
case "$*" in
 *ci.yml/runs*) echo '{"workflow_runs":[{"head_sha":"${source}","head_branch":"main","status":"completed","conclusion":"success"}]}' ;;
 */releases?*) echo '[{"tag_name":"v0.15.0","draft":false,"prerelease":false}]' ;;
 *release.yml/runs*) echo '{"workflow_runs":[{"head_sha":"'"$(git rev-parse v0.15.1^{commit})"'","status":"completed","conclusion":"failure"}]}' ;;
 *) exit 1;;
esac
`,
      { mode: 0o700 },
    );
    NodeFS.symlinkSync(
      NodePath.join(import.meta.dirname, "../node_modules"),
      NodePath.join(root, "node_modules"),
      "dir",
    );
    const invoke = (dry: boolean) =>
      NodeChildProcess.spawnSync(
        process.execPath,
        [
          NodePath.join(import.meta.dirname, "release-mate.ts"),
          "--from-sha",
          source,
          ...(dry ? ["--dry-run"] : []),
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          timeout: 30_000,
        },
      );
    const plan = invoke(true);
    expect(plan.status, plan.stderr).toBe(0);
    expect(plan.stdout).toContain(`source: ${source}`);
    expect(plan.stdout).toContain("critical fix");
    expect(plan.stdout).not.toContain("- pending main");
    const release = invoke(false);
    expect(release.status, release.stderr).toBe(1);
    expect(release.stderr).toContain("release CI failed");
    expect(
      git("rev-parse", "refs/remotes/origin/main"),
      "ASSERTION: main must continue independently of the release",
    ).toBe(head);
    expect(git("rev-parse", "v0.15.1^"), "ASSERTION: R must have S as its only parent").toBe(
      source,
    );
    expect(git("diff", "--name-only", source, "v0.15.1").split("\n").toSorted()).toEqual(
      files.toSorted(),
    );
    expect(git("ls-remote", "--tags", "origin", "refs/tags/v0.15.1")).toContain(
      "refs/tags/v0.15.1",
    );
  } finally {
    NodeFS.rmSync(root, { recursive: true });
  }
});
