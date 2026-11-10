// @effect-diagnostics nodeBuiltinImport:off -- exercises the smoke command boundary without browsers.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import { parse } from "yaml";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ciSelectionManifest } from "./ci-blame.ts";
import { affectedScenarioFiles } from "./gate-changed.ts";
import { runStateSmoke, stateSmokePlan } from "./state-smoke.ts";
import { stateOnlySmoke } from "./state-smoke-cases.ts";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("./gate-changed.ts", () => ({ affectedScenarioFiles: vi.fn() }));

const root = NodePath.resolve("/smoke-repository");
const spawn = vi.mocked(NodeChildProcess.spawnSync);
const affected = vi.mocked(affectedScenarioFiles);
const base = "abcdef123456";
const scenario = (name: string) => `apps/web/test/scenarios/areas/c-mate/${name}.scenario.ts`;
const commands = () =>
  spawn.mock.calls.filter(([command]) => command === "vp").map(([, args]) => args!);

// CI's selection job: the plan's published matrix and selection, as the shards receive them.
const planOutputs = (args: ReadonlyArray<string>) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-state-smoke-plan-"));
  const previous = process.env.GITHUB_OUTPUT;
  const previousManifest = process.env.MATE_CI_SELECTION;
  process.env.GITHUB_OUTPUT = NodePath.join(dir, "output");
  process.env.MATE_CI_SELECTION = JSON.stringify(
    ciSelectionManifest(
      "refs/heads/kh-next",
      "0123456789012345678901234567890123456789",
      undefined,
      "workflow_dispatch",
    ),
  );
  try {
    expect(runStateSmoke(root, ["--plan", ...args])).toBe(0);
    const outputs = Object.fromEntries(
      NodeFS.readFileSync(process.env.GITHUB_OUTPUT, "utf8")
        .trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    return {
      matrix: JSON.parse(outputs.state_smoke!) as { include: { shard: number; total: number }[] },
      selection: outputs.state_smoke_selection!,
      manifest: JSON.parse(outputs.selection_manifest ?? "null") as unknown,
    };
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previous;
    if (previousManifest === undefined) delete process.env.MATE_CI_SELECTION;
    else process.env.MATE_CI_SELECTION = previousManifest;
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
};

beforeEach(() => {
  vi.stubEnv("GITHUB_ACTIONS", "");
  vi.stubEnv("GITHUB_SHA", "0123456789012345678901234567890123456789");
  vi.resetAllMocks();
  affected.mockReturnValue([]);
  spawn.mockReturnValue({ pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null });
});

afterEach(() => vi.unstubAllEnvs());

it("State Smoke records each executed stage in one shard evidence file", () => {
  const previous = process.env.MATE_SIGNAL_REPORT;
  const report = NodePath.join(NodeOS.tmpdir(), `state-smoke-evidence-${process.pid}.json`);
  process.env.MATE_SIGNAL_REPORT = report;
  try {
    affected.mockReturnValue([scenario("affected")]);
    expect(runStateSmoke(root, ["--base", base])).toBe(0);
    expect(commands()).toHaveLength(3);
    for (const args of commands())
      expect(args).toContain("--reporter=../../scripts/signal-reporter.ts");
    for (const [, , options] of spawn.mock.calls.filter(([command]) => command === "vp"))
      expect(options!.env!.MATE_SIGNAL_REPORT).toBe(report);
  } finally {
    if (previous === undefined) delete process.env.MATE_SIGNAL_REPORT;
    else process.env.MATE_SIGNAL_REPORT = previous;
  }
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

it("State Smoke CI gives sign-in its own job and spreads a full selection across bounded partitions without losing cases", () => {
  const files = Array.from({ length: 58 }, (_, index) => scenario(`full-${index}`));
  affected.mockReturnValue(files);
  const { matrix, selection, manifest } = planOutputs(["--base", base]);
  expect(manifest).toMatchObject({
    version: 1,
    context: "ci",
    candidate: "0123456789012345678901234567890123456789",
    stateSmoke: { base, affected: files, matrix },
  });
  const previousManifest = process.env.MATE_CI_SELECTION;
  process.env.MATE_CI_SELECTION = JSON.stringify(manifest);
  let partitions: (readonly string[])[][];
  try {
    partitions = matrix.include.map(({ shard, total }) => {
      spawn.mockClear();
      runStateSmoke(root, ["--selection", selection, "--shard", `${shard}/${total}`]);
      return commands();
    });
  } finally {
    if (previousManifest === undefined) delete process.env.MATE_CI_SELECTION;
    else process.env.MATE_CI_SELECTION = previousManifest;
  }
  expect(partitions, "ASSERTION: the full suite has eight independent 14-minute jobs").toHaveLength(
    8,
  );
  expect(partitions[0], "ASSERTION: the first job runs sign-in alone").toEqual([
    expect.arrayContaining(["test/scenarios/areas/a-signin"]),
  ]);
  const runs = partitions.flat();
  expect(runs.filter((args) => args.includes("test/scenarios/areas/a-signin"))).toHaveLength(1);
  expect(runs.filter((args) => args.includes("--testNamePattern"))).toHaveLength(1);
  for (const file of files) {
    expect(
      runs.filter((args) => args.includes(NodePath.join(root, file))),
      `ASSERTION: full-suite scenario ${file} runs exactly once`,
    ).toHaveLength(1);
  }
  for (const partition of partitions.slice(1)) {
    expect(
      partition
        .flat()
        .filter((argument) => files.some((file) => NodePath.join(root, file) === argument)).length,
      "ASSERTION: no partition holds more than its share of the full selection rounded up",
    ).toBeLessThanOrEqual(Math.ceil(files.length / (partitions.length - 1)));
  }
});

// witness: scripts/ci-blame.ts | (candidate !== undefined && manifest.candidate !== candidate) || → false ||
it.each(["candidate", "plan", "base"])(
  "State Smoke rejects a %s mismatch in the CI manifest before running any shard",
  (missing) => {
    affected.mockReturnValue([scenario("affected")]);
    const { selection, manifest, matrix } = planOutputs(["--base", base]);
    const input = manifest as Record<string, unknown>;
    const previousManifest = process.env.MATE_CI_SELECTION;
    const previousSha = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = "0123456789012345678901234567890123456789";
    process.env.MATE_CI_SELECTION = JSON.stringify(
      missing === "candidate"
        ? { ...input, candidate: "wrong-candidate" }
        : missing === "plan"
          ? { ...input, stateSmoke: undefined }
          : { ...input, stateSmoke: { ...(input.stateSmoke as object), base: undefined } },
    );
    try {
      expect(() =>
        runStateSmoke(root, ["--selection", selection, "--shard", `1/${matrix.include[0]!.total}`]),
      ).toThrow(/CI selection manifest/u);
      expect(commands()).toEqual([]);
    } finally {
      if (previousManifest === undefined) delete process.env.MATE_CI_SELECTION;
      else process.env.MATE_CI_SELECTION = previousManifest;
      if (previousSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previousSha;
    }
  },
);

// witness: scripts/state-smoke.ts | process.env.GITHUB_ACTIONS === "true" && !process.env.MATE_CI_SELECTION) → false)
it.each([
  ["planning", ["--plan", "--base", base]],
  ["a shard", ["--selection", "[]", "--shard", "1/1"]],
])("State Smoke refuses %s when CI did not publish its selection manifest", (_name, args) => {
  const previousManifest = process.env.MATE_CI_SELECTION;
  const previousActions = process.env.GITHUB_ACTIONS;
  delete process.env.MATE_CI_SELECTION;
  process.env.GITHUB_ACTIONS = "true";
  try {
    expect(() => runStateSmoke(root, args)).toThrow(/CI selection manifest/u);
    expect(commands()).toEqual([]);
  } finally {
    if (previousManifest === undefined) delete process.env.MATE_CI_SELECTION;
    else process.env.MATE_CI_SELECTION = previousManifest;
    if (previousActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previousActions;
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
  // prepare selects once; every shard runs its part of that selection.
  const prepare = workflow.jobs.selection;
  const plan = prepare.steps.find((step: { id?: string }) => step.id === "state_smoke_plan");
  expect(
    prepare.steps.find((step: { name: string }) => step.name === "Checkout for State Smoke's plan")
      ?.with["fetch-depth"],
    "ASSERTION: CI needs full history for the shared affected-scenario graph",
  ).toBe(0);
  const job = workflow.jobs.state_smoke;
  expect(job.if).not.toContain("needs.changes.outputs.chat");
  expect(plan.env.MATE_SCENARIO_BASE).toBe(
    "${{ github.event.pull_request.base.sha || github.event.before || '0000000000000000000000000000000000000000' }}",
  );
  expect(plan.run).toContain('node scripts/state-smoke.ts --plan --base "$MATE_SCENARIO_BASE"');
  expect(prepare.outputs.state_smoke).toBe("${{ steps.state_smoke_plan.outputs.state_smoke }}");
  const run = job.steps.find(
    (step: { name: string }) => step.name === "Certify sign-in, fixed smoke and affected scenarios",
  );
  expect(run.env.MATE_STATE_SMOKE_SELECTION).toBe(
    "${{ needs.selection.outputs.state_smoke_selection }}",
  );
  expect(run.run).toContain(
    'node scripts/state-smoke.ts --selection "$MATE_STATE_SMOKE_SELECTION" --shard ${{ matrix.shard }}/${{ matrix.total }}',
  );
});

// The affected selection of kh-next 3806f043a1 against its event base 40fd2b97ff and against
// origin/main bedb7d767e: every scenario file. Its eight fixed shards outran the 14-minute timeout.
const selection3806 = [
  "a-signin/account",
  "a-signin/arrival",
  "a-signin/deviceLogin",
  "b-menu/automated",
  "b-menu/chief-setup",
  "b-menu/decode",
  "b-menu/drafts",
  "b-menu/environmentIdentity",
  "b-menu/liveness",
  "b-menu/reload",
  "b-menu/usage",
  "b-menu/usageStates",
  "c-mate/admission",
  "c-mate/chat",
  "c-mate/chief-registration",
  "c-mate/composer-overlap",
  "c-mate/composer",
  "c-mate/context-window",
  "c-mate/engine-card",
  "c-mate/engine-page",
  "c-mate/engine-secret",
  "c-mate/first-send",
  "c-mate/fold-work",
  "c-mate/health",
  "c-mate/identity",
  "c-mate/image-layout",
  "c-mate/images",
  "c-mate/opening",
  "c-mate/overview-filter",
  "c-mate/overview-reload",
  "c-mate/owner-reported-layout-regressions-composer",
  "c-mate/owner-reported-layout-regressions-conversation",
  "c-mate/owner-reported-layout-regressions-live-card",
  "c-mate/owner-reported-layout-regressions-menu",
  "c-mate/ownership-loading",
  "c-mate/projects-opening",
  "c-mate/providerLimits",
  "c-mate/recovery",
  "c-mate/replay",
  "d-change/git-diff-jump",
  "d-change/repository",
  "d-change/review",
  "e-env/card-paint",
  "e-env/environments",
  "e-env/failures",
  "e-env/observation",
  "e-env/parts",
  "e-env/projects-layout",
  "e-env/release-sheet-fits",
  "f-create/creation",
  "f-create/new-mate-fits",
  "f-create/stage-paint",
  "foundation/examples",
  "foundation/extensions",
  "foundation/hqTimings",
  "foundation/menuRow",
  "foundation/realMate",
  "foundation/session",
  "foundation/sharedScenario",
  "g-outage/outages",
  "h-budget/budgets",
  "h-budget/bundle",
  "lifecycle-mutations/moving",
].map((name) => `apps/web/test/scenarios/areas/${name}.scenario.ts`);
const minutes = (ms: number) => ms / 60_000;

it.each([
  { name: "no affected scenario", files: [], shards: 2 },
  {
    name: "three affected scenarios",
    files: [
      scenario("chat"),
      scenario("images"),
      "apps/web/test/scenarios/areas/e-env/parts.scenario.ts",
    ],
    shards: 5,
  },
  { name: "kh-next 3806f043a1, every scenario file", files: selection3806, shards: 8 },
  {
    name: "three times the scenario suite",
    files: Array.from({ length: 190 }, (_, index) => scenario(`unmeasured-${index}`)),
    shards: 16,
  },
])(
  "Decision: prepare computes the affected scenario selection once and emits as many State Smoke shards as keep each shard's measured work under ~9 min (cap 16 shards); a small selection still runs 8 or fewer. The job timeout stays 14. (%o)",
  ({ files, shards }) => {
    affected.mockReturnValue(files);
    const { matrix } = planOutputs(["--base", base]);
    expect(affected, "ASSERTION: prepare selects once").toHaveBeenCalledTimes(1);
    expect(matrix.include.map(({ shard }) => shard)).toEqual(
      Array.from({ length: shards }, (_, index) => index + 1),
    );
    const plan = stateSmokePlan(files);
    expect(plan.shards).toHaveLength(shards);
    if (shards < 16)
      for (const { estimateMs } of plan.shards)
        expect(
          minutes(estimateMs),
          "ASSERTION: a shard's measured work fits ~9 min",
        ).toBeLessThanOrEqual(9);
    if (files.length < 8)
      expect(shards, "ASSERTION: a small selection still runs 8 or fewer").toBeLessThanOrEqual(8);
    const workflow = parse(
      NodeFS.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    );
    expect(workflow.jobs.state_smoke["timeout-minutes"]).toBe(14);
  },
);

it("Decision: shards split the selection by recorded per-file duration when available (else by count), so shards finish within a minute of each other.", () => {
  const measured = stateSmokePlan(selection3806).shards.slice(1);
  const times = measured.map(({ estimateMs }) => estimateMs);
  expect(
    minutes(Math.max(...times) - Math.min(...times)),
    "ASSERTION: measured shards finish within a minute of each other",
  ).toBeLessThanOrEqual(1);
  // Affecting the fixed smoke's files leaves no fixed smoke stage, so nothing here is measured.
  const unmeasured = [
    ...Object.keys(stateOnlySmoke),
    ...Array.from({ length: 27 }, (_, index) => scenario(`new-${index}`)),
  ];
  const counts = stateSmokePlan(unmeasured, 7, {})
    .shards.slice(1)
    .map(({ files }) => files.length);
  expect(
    Math.max(...counts) - Math.min(...counts),
    "ASSERTION: without measurements shards split by count",
  ).toBeLessThanOrEqual(1);
});

it("Decision: the selection itself (which scenarios run) does not change; no scenario is dropped or quarantined by this change.", () => {
  affected.mockReturnValue(selection3806);
  const { matrix, selection } = planOutputs(["--base", base]);
  expect(JSON.parse(selection), "ASSERTION: shards receive the whole selection").toEqual(
    selection3806,
  );
  const runs = matrix.include.flatMap(({ shard, total }) => {
    spawn.mockClear();
    runStateSmoke(root, ["--selection", selection, "--shard", `${shard}/${total}`]);
    return commands();
  });
  expect(runs.filter((args) => args.includes("test/scenarios/areas/a-signin"))).toHaveLength(1);
  for (const file of selection3806.filter((file) => !file.includes("/a-signin/")))
    expect(
      runs.filter((args) => args.includes(NodePath.join(root, file))),
      `ASSERTION: ${file} runs exactly once`,
    ).toHaveLength(1);
});
