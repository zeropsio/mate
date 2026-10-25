// @effect-diagnostics nodeBuiltinImport:off -- exercises the smoke command boundary without browsers.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";
import { parse } from "yaml";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { affectedScenarioFiles } from "./gate-changed.ts";
import { runStateSmoke } from "./state-smoke.ts";
import { stateOnlySmoke } from "./state-smoke-cases.ts";
import { blameMatrices } from "./ci-blame.ts";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("./gate-changed.ts", () => ({ affectedScenarioFiles: vi.fn() }));

const root = NodePath.resolve("/smoke-repository");
const spawn = vi.mocked(NodeChildProcess.spawnSync);
const affected = vi.mocked(affectedScenarioFiles);
const base = "abcdef123456";
const scenario = (name: string) => `apps/web/test/scenarios/areas/c-mate/${name}.scenario.ts`;
const commands = () =>
  spawn.mock.calls.filter(([command]) => command === "vp").map(([, args]) => args!);

beforeEach(() => {
  vi.resetAllMocks();
  affected.mockReturnValue([]);
  spawn.mockReturnValue({ pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null });
});

it("State Smoke runs every affected scenario alongside sign-in and the fixed smoke", () => {
  const files = Array.from({ length: 12 }, (_, index) => scenario(`affected-${index}`));
  affected.mockReturnValue(files);
  expect(runStateSmoke(root, ["--base", base])).toBe(0);
  expect(affected).toHaveBeenCalledWith(root, base, []);
  const runs = commands();
  expect(runs[0]).toContain("test/scenarios/areas/a-signin");
  expect(runs[1]).toContain("--testNamePattern");
  for (const file of files) {
    expect(runs[2], `ASSERTION: affected scenario ${file} must reach the browser runner`).toContain(
      NodePath.join(root, file),
    );
  }
  expect(runs[2]).not.toContain("--testNamePattern");
});

it("State Smoke omits fixed cases already covered by a full affected file", () => {
  const [full, ...remaining] = Object.keys(stateOnlySmoke);
  affected.mockReturnValue([full!]);
  runStateSmoke(root, ["--base", base]);
  const runs = commands();
  expect(runs[1]).not.toContain(NodePath.join(root, full!));
  for (const file of remaining) expect(runs[1]).toContain(NodePath.join(root, file));
  const smokeEnvironment = spawn.mock.calls[1]![2]!.env!;
  expect(JSON.parse(smokeEnvironment.MATE_GATE_SMOKE_CASES!)).toEqual(
    Object.fromEntries(Object.entries(stateOnlySmoke).filter(([file]) => file !== full)),
  );
  expect(runs[2]).toContain(NodePath.join(root, full!));
});

it("State Smoke shards affected files once while retaining sign-in and fixed smoke", () => {
  const files = Array.from({ length: 11 }, (_, index) => scenario(`sharded-${index}`));
  affected.mockReturnValue(files);
  runStateSmoke(root, ["--base", base, "--shard", "1/2"]);
  const first = commands();
  spawn.mockClear();
  runStateSmoke(root, ["--base", base, "--shard", "2/2"]);
  const second = commands();
  expect(first[0]).toContain("test/scenarios/areas/a-signin");
  expect(first.flat()).not.toContain("--testNamePattern");
  expect(second.flat()).toContain("--testNamePattern");
  for (const file of files) {
    expect(
      [...first, ...second].filter((args) => args.includes(NodePath.join(root, file))),
    ).toHaveLength(1);
  }
});

it("State Smoke CI spreads a full selection across four bounded partitions without losing cases", () => {
  const files = Array.from({ length: 58 }, (_, index) => scenario(`full-${index}`));
  affected.mockReturnValue(files);
  const partitions = blameMatrices.state_smoke.map(({ shard, total }) => {
    spawn.mockClear();
    runStateSmoke(root, ["--base", base, "--shard", `${shard}/${total}`]);
    return commands();
  });
  expect(partitions, "ASSERTION: the full suite has four independent 14-minute jobs").toHaveLength(
    4,
  );
  const runs = partitions.flat();
  expect(runs.filter((args) => args.includes("test/scenarios/areas/a-signin"))).toHaveLength(1);
  expect(runs.filter((args) => args.includes("--testNamePattern"))).toHaveLength(1);
  for (const file of files) {
    expect(
      runs.filter((args) => args.includes(NodePath.join(root, file))),
      `ASSERTION: full-suite scenario ${file} runs exactly once`,
    ).toHaveLength(1);
  }
  for (const partition of partitions) {
    expect(
      partition
        .flat()
        .filter((argument) => files.some((file) => NodePath.join(root, file) === argument)).length,
      "ASSERTION: no partition holds more than a quarter of the full selection rounded up",
    ).toBeLessThanOrEqual(Math.ceil(files.length / 4));
  }
});

it("State Smoke passes explicitly requested scenarios to the shared selector", () => {
  runStateSmoke(root, ["--base", base, "--scenarios", scenario("explicit"), scenario("other")]);
  expect(affected).toHaveBeenCalledWith(root, base, [scenario("explicit"), scenario("other")]);
});

it.each([undefined, "0000000000000000000000000000000000000000"])(
  "State Smoke compares missing or new-branch event bases against the empty tree (%s)",
  (eventBase) => {
    spawn.mockReturnValueOnce({
      pid: 1,
      output: [],
      stdout: "empty-tree-sha\n",
      stderr: "",
      status: 0,
      signal: null,
    });
    runStateSmoke(root, eventBase ? ["--base", eventBase] : []);
    expect(spawn.mock.calls[0]?.slice(0, 2)).toEqual([
      "git",
      ["hash-object", "-t", "tree", "--stdin"],
    ]);
    expect(affected).toHaveBeenCalledWith(root, "empty-tree-sha", []);
  },
);

it("State Smoke fails clearly when it cannot resolve the empty-tree fallback", () => {
  spawn.mockReturnValueOnce({
    pid: 1,
    output: [],
    stdout: "",
    stderr: "cannot read git repository",
    status: 128,
    signal: null,
  });
  expect(() => runStateSmoke(root, [])).toThrow("State Smoke cannot resolve its comparison base");
  expect(affected).not.toHaveBeenCalled();
  expect(commands()).toEqual([]);
});

it("State Smoke preserves a failing browser stage exit status", () => {
  spawn.mockReturnValueOnce({
    pid: 1,
    output: [],
    stdout: "",
    stderr: "",
    status: 7,
    signal: null,
  });
  expect(runStateSmoke(root, ["--base", base])).toBe(7);
  expect(commands()).toHaveLength(1);
});

it.each(["0/2", "3/2", "1/0", "1.5/2", "1/2/3"])(
  "State Smoke rejects invalid shard %s before selecting or running scenarios",
  (shard) => {
    expect(() => runStateSmoke(root, ["--base", base, "--shard", shard])).toThrow(
      "--shard expects",
    );
    expect(affected).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  },
);

it("State Smoke CI compares the event base with full history and runs beyond chat-only changes", () => {
  const workflow = parse(
    NodeFS.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  );
  const job = workflow.jobs.state_smoke;
  expect(
    job.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"))?.with[
      "fetch-depth"
    ],
    "ASSERTION: CI needs full history for the shared affected-scenario graph",
  ).toBe(0);
  expect(job.if).not.toContain("needs.changes.outputs.chat");
  const run = job.steps.at(-1);
  expect(run.env.MATE_SCENARIO_BASE).toBe(
    "${{ github.event.pull_request.base.sha || github.event.before || '0000000000000000000000000000000000000000' }}",
  );
  expect(run.run).toContain(
    'node scripts/state-smoke.ts --base "$MATE_SCENARIO_BASE" --shard ${{ matrix.shard }}/${{ matrix.total }}',
  );
});
