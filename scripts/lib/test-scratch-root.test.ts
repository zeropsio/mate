// @effect-diagnostics nodeBuiltinImport:off -- the scratch root is a real directory tree.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  SCRATCH_OWNER_FILE,
  TEST_RAMDISK_TMPDIR,
  testRamdiskRoot,
  useTestScratchRoot,
} from "./test-scratch-root.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

/** A stand-in for the RAM disk's temp root: a real directory, written only through the module. */
const scratchRoot = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-scratch-root-"));
  roots.push(root);
  return root;
};

/** One run's start in process `pid`, as a Vite config does it; returns its TMPDIR and exit hook. */
const startRun = (
  root: string,
  pid: number,
  alive: (pid: number) => boolean,
  env: NodeJS.ProcessEnv = {},
) => {
  let exit = () => {};
  useTestScratchRoot(env, {
    root,
    pid,
    isWritable: (directory) => directory === root,
    alive,
    onExit: (remove) => {
      exit = remove;
    },
  });
  return { tmpdir: env["TMPDIR"], exit: () => exit() };
};

describe("the test scratch root", () => {
  it.each([
    {
      title: "the RAM disk is present: TMPDIR points at it",
      present: true,
      before: "/var/x",
    },
    {
      title: "the RAM disk is absent: TMPDIR is unchanged",
      present: false,
      before: "/var/x",
    },
    {
      title: "the RAM disk is absent and TMPDIR unset: it stays unset",
      present: false,
      before: undefined,
    },
  ])("$title", ({ present, before }) => {
    const root = scratchRoot();
    const env: NodeJS.ProcessEnv = before === undefined ? {} : { TMPDIR: before };
    useTestScratchRoot(env, {
      root,
      pid: 4242,
      isWritable: (directory) => present && directory === root,
      alive: () => true,
      onExit: () => {},
    });
    if (present) {
      expect(NodePath.dirname(env["TMPDIR"]!)).toBe(root);
      expect(NodeFS.readdirSync(env["TMPDIR"]!)).toEqual([SCRATCH_OWNER_FILE]);
    } else expect(env["TMPDIR"]).toBe(before);
  });

  // witness: scripts/lib/test-scratch-root.ts | if (env["MATE_TEST_TMPDIR"]) { → if (false) {
  it("an explicit test scratch directory takes precedence over the shared RAM disk", () => {
    const env: NodeJS.ProcessEnv = {
      MATE_TEST_TMPDIR: "/work/scratch",
      TMPDIR: "/system/tmp",
    };
    useTestScratchRoot(env, { isWritable: () => true });
    expect(env["TMPDIR"]).toBe("/work/scratch");
  });

  // witness: scripts/lib/test-scratch-root.ts | return Number.isInteger(pid) && pid > 0 && !alive(pid); → return Number.isInteger(pid) && pid > 0;
  it("a run's start reclaims the scratch directories whose recorded owner process is gone, and keeps a running owner's and any directory without an owner record", () => {
    const root = scratchRoot();
    const running = new Set([101, 202, 303]);
    const alive = (pid: number) => running.has(pid);
    const gone = startRun(root, 101, alive).tmpdir!;
    const kept = startRun(root, 202, alive).tmpdir!;
    NodeFS.mkdirSync(NodePath.join(gone, "bridge-acp-mock-abc", "deep"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(gone, "bridge-acp-mock-abc", "deep", "log"), "x");
    NodeFS.writeFileSync(NodePath.join(kept, "work"), "x");
    // Named like a dead run, but nothing recorded its owner: no proof it is ours.
    NodeFS.mkdirSync(NodePath.join(root, "z3-run-101-unrecorded"));
    NodeFS.mkdirSync(NodePath.join(root, "run-101-mate-hq"));
    running.delete(101);

    const next = startRun(root, 303, alive).tmpdir!;

    expect(NodeFS.readdirSync(root).toSorted()).toEqual(
      [
        kept,
        next,
        NodePath.join(root, "run-101-mate-hq"),
        NodePath.join(root, "z3-run-101-unrecorded"),
      ]
        .map((path) => NodePath.basename(path))
        .toSorted(),
    );
    expect(NodeFS.readFileSync(NodePath.join(kept, "work"), "utf8")).toBe("x");
  });

  // witness: scripts/lib/test-scratch-root.ts | onExit(() => removeScratch(run)); → onExit(() => undefined);
  it("a run's scratch directory leaves with its process", () => {
    const root = scratchRoot();
    const run = startRun(root, 404, () => true);
    NodeFS.mkdirSync(NodePath.join(run.tmpdir!, "t3-git-manager-test-x"));

    run.exit();

    expect(NodeFS.readdirSync(root)).toEqual([]);
  });

  // witness: scripts/lib/test-scratch-root.ts | ownerRecord(current) === String(pid) → false
  it("a config that loads again in the same process keeps the scratch directory it already made", () => {
    const root = scratchRoot();
    const env: NodeJS.ProcessEnv = {};
    const first = startRun(root, 505, () => true, env).tmpdir;

    const second = startRun(root, 505, () => true, env).tmpdir;

    expect(second).toBe(first);
    expect(NodeFS.readdirSync(root)).toEqual([NodePath.basename(first!)]);
  });

  it.each([
    { present: true, root: "/Volumes/mate-test" },
    { present: false, root: undefined },
  ])("the RAM disk root is $root when present is $present", ({ present, root }) => {
    expect(testRamdiskRoot((directory) => present && directory === TEST_RAMDISK_TMPDIR)).toBe(root);
  });
});
