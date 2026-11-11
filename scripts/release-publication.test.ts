// @effect-diagnostics nodeBuiltinImport:off -- Executes the workflow publication step in a disposable directory.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import { parse } from "yaml";

const workflow: {
  jobs: { release: { steps: ReadonlyArray<{ name?: string; run?: string }> } };
} = parse(
  NodeFS.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
);
const publication = workflow.jobs.release.steps.find(
  (step) => step.name === "Create GitHub release",
);

it.each([
  { state: "fresh", existing: false },
  { state: "partially published", existing: true },
])("a $state release publishes every verified asset and becomes latest", ({ existing }) => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "release-publication-"));
  try {
    if (publication?.run === undefined) throw new Error("Missing release publication command");
    const assets = {
      "mate.tgz": "verified bundle",
      SHA256SUMS: "verified checksum",
      "stable.json": '{"version":"0.15.2"}',
    };
    NodeFS.mkdirSync(NodePath.join(root, "release-assets"));
    for (const [name, content] of Object.entries(assets)) {
      NodeFS.writeFileSync(NodePath.join(root, "release-assets", name), content);
    }
    const published = NodePath.join(root, "published");
    if (existing) {
      NodeFS.mkdirSync(published);
      NodeFS.writeFileSync(NodePath.join(published, "mate.tgz"), "interrupted upload");
    }
    const bin = NodePath.join(root, "bin");
    NodeFS.mkdirSync(bin);
    const command = NodePath.join(bin, "gh");
    NodeFS.writeFileSync(
      command,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const published = path.join(process.cwd(), "published");
fs.appendFileSync("requests.jsonl", JSON.stringify(args) + "\\n");
const exists = fs.existsSync(published);
const [resource, action, tag] = args;
if (resource !== "release" || tag !== "v0.15.2") process.exit(2);
if (action === "view") {
  if (!exists) process.exit(1);
  process.stdout.write(JSON.stringify({tagName: tag}));
} else if (action === "create" || action === "upload") {
  if (action === "create" && exists) {
    process.stderr.write("release already exists\\n");
    process.exit(1);
  }
  if (action === "upload" && !exists) process.exit(1);
  fs.mkdirSync(published, {recursive: true});
  for (const asset of args.filter((arg) => arg.startsWith("release-assets/"))) {
    const target = path.join(published, path.basename(asset));
    if (action === "upload" && fs.existsSync(target) && !args.includes("--clobber")) process.exit(1);
    fs.copyFileSync(asset, target);
  }
  if (action === "create" && args.includes("--latest")) fs.writeFileSync("latest", tag);
} else if (action === "edit" && exists && args.includes("--latest")) {
  fs.writeFileSync("latest", tag);
} else process.exit(2);
`,
      { mode: 0o700 },
    );
    const result = NodeChildProcess.spawnSync("bash", ["-c", publication.run], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELEASE_TAG: "v0.15.2" },
      timeout: 10_000,
    });
    expect(
      result.status,
      `ASSERTION: publication completes after an interrupted asset upload: ${result.stderr}`,
    ).toBe(0);
    expect(NodeFS.readdirSync(published).sort()).toEqual(Object.keys(assets).sort());
    for (const [name, content] of Object.entries(assets)) {
      expect(NodeFS.readFileSync(NodePath.join(published, name), "utf8")).toBe(content);
    }
    expect(NodeFS.readFileSync(NodePath.join(root, "latest"), "utf8")).toBe("v0.15.2");
    const requests = NodeFS.readFileSync(NodePath.join(root, "requests.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(requests.some((args) => args[1] === "create")).toBe(!existing);
    if (existing) {
      expect(requests.find((args) => args[1] === "upload")).toEqual([
        "release",
        "upload",
        "v0.15.2",
        "release-assets/SHA256SUMS",
        "release-assets/mate.tgz",
        "release-assets/stable.json",
        "--clobber",
      ]);
    } else {
      expect(requests.find((args) => args[1] === "create")).toEqual([
        "release",
        "create",
        "v0.15.2",
        "release-assets/SHA256SUMS",
        "release-assets/mate.tgz",
        "release-assets/stable.json",
        "--generate-notes",
        "--verify-tag",
        "--latest",
      ]);
    }
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
