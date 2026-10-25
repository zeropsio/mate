// @effect-diagnostics nodeBuiltinImport:off -- execute CI's committed selector and job conditions.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parse } from "yaml";
import { expect, it } from "vite-plus/test";
import { blameSelection } from "./ci-blame.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const workflow = parse(
  NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"),
);

it("Bisect CI selects only the failed job and preserves its full partition size", () => {
  const selection = blameSelection("refs/heads/kh-bisect/abc1234", "Test Web 2\n");
  expect(selection.selected, "ASSERTION: a single failed shard starts no unrelated job").toEqual([
    "test_web",
  ]);
  expect(selection.matrices.test_web).toEqual({ include: [{ shard: 2, total: 3 }] });
  for (const [job, definition] of Object.entries(workflow.jobs) as [string, { if?: string }][]) {
    if (job === "prepare" || job === "cache") continue;
    expect(definition.if, `ASSERTION: ${job} consumes the one selected job verdict`).toContain(
      `contains(fromJSON(needs.prepare.outputs.jobs), '${job}')`,
    );
  }
  expect(workflow.jobs.test_web.strategy.matrix).toBe(
    "${{ fromJSON(needs.prepare.outputs.test_web) }}",
  );
  expect(
    workflow.jobs.test_web.steps.find((step: { name: string }) => step.name === "Test").run,
  ).toContain("--shard ${{ matrix.shard }}/${{ matrix.total }}");
});

it("Blocking blame runs state smoke with its bundle and never selects Signal jobs", () => {
  const selection = blameSelection("refs/heads/kh-bisect/abc1234", "State Smoke 2\n");
  expect(
    selection.selected.sort(),
    "ASSERTION: blocking State Smoke selects only its execution dependencies",
  ).toEqual(["changes", "state_smoke"]);
  expect(selection.matrices.state_smoke).toEqual({ include: [{ shard: 2, total: 8 }] });
  for (const context of ["Test Web Scenarios (C shard 3)", "Signal classification"]) {
    expect(
      () => blameSelection("refs/heads/kh-bisect/abc1234", context),
      "ASSERTION: Signal jobs cannot be selected by blocking CI blame",
    ).toThrow("No known failed CI job");
  }
});

it("Summary failures rerun their failed dependencies without selecting unrelated suites", () => {
  const selection = blameSelection(
    "refs/heads/kh-bisect/abc1234",
    "Test\nTest Scripts 1\nRelease Smoke\nCheck\n",
  );
  expect(selection.selected.sort()).toEqual([
    "changes",
    "check",
    "check_build",
    "check_guards",
    "check_types",
    "release_smoke",
    "test",
    "test_scripts",
  ]);
  expect(selection.matrices.test_hq!.include).toEqual([]);
  expect(workflow.jobs.test.steps.at(-1).run).toContain("needs.prepare.outputs.blame == 'true'");
});

it.each([
  ["Check", "check"],
  ["Check Guards", "check_guards"],
  ["Check Types", "check_types"],
  ["Check Build", "check_build"],
])("Bisect CI selects %s with only its execution dependencies", (name, job) => {
  expect(
    blameSelection("refs/heads/kh-bisect/abc1234", `${name}\n`).selected.sort(),
    "ASSERTION: each Check worker selects Changes without its sibling workers",
  ).toEqual(["changes", job].sort());
});

it.each(["refs/heads/main", "refs/heads/kh-next", "refs/pull/1/merge"])(
  "%s retains full CI even with a stray blame manifest",
  (ref) => {
    const selection = blameSelection(ref, "Test Web 2\n");
    expect(selection.narrowed).toBe(false);
    expect(selection.selected.sort()).toEqual(
      Object.keys(workflow.jobs)
        .filter((job) => job !== "prepare" && job !== "cache")
        .sort(),
    );
    expect(selection.matrices.test_server!.include).toEqual(
      [1, 2, 3, 4, 5, 6].map((shard) => ({ shard, total: 6 })),
    );
    expect(selection.selected).not.toContain("chat_scenarios");
  },
);

it("A kh-bisect push without a manifest is refused naming the file, and unknown selections fail explicitly", () => {
  expect(() => blameSelection("refs/heads/kh-bisect/abc1234", undefined)).toThrow(
    "kh-bisect needs .ci-blame-jobs",
  );
  expect(() => blameSelection("refs/heads/kh-bisect/abc1234", "unknown\n")).toThrow(
    "No known failed CI job",
  );
});

it.each([["\n"], [""], ["  \n\n"]])(
  "A kh-bisect push with an empty manifest %j selects no job",
  (manifest) => {
    const selection = blameSelection("refs/heads/kh-bisect/signal-x", manifest);
    expect(selection.narrowed).toBe(true);
    expect(selection.selected).toEqual([]);
    for (const matrix of Object.values(selection.matrices)) expect(matrix.include).toEqual([]);
  },
);

it("A kh-bisect manifest of all selects every job at full partition size", () => {
  const selection = blameSelection("refs/heads/kh-bisect/abc1234", "all\n");
  expect(selection.narrowed).toBe(false);
  expect(selection.selected.sort()).toEqual(
    Object.keys(workflow.jobs)
      .filter((job) => job !== "prepare" && job !== "cache")
      .sort(),
  );
  expect(selection.matrices.test_server!.include).toHaveLength(6);
});

it("CI's real selector command publishes its narrowed job and matrix outputs", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-ci-blame-"));
  try {
    NodeFS.mkdirSync(NodePath.join(dir, "scripts"));
    NodeFS.copyFileSync(
      NodePath.join(root, "scripts/ci-blame.ts"),
      NodePath.join(dir, "scripts/ci-blame.ts"),
    );
    NodeFS.writeFileSync(NodePath.join(dir, ".ci-blame-jobs"), "Test Server 4\n");
    const output = NodePath.join(dir, "output");
    const step = workflow.jobs.prepare.steps.find((entry: { id?: string }) => entry.id === "blame");
    const result = NodeChildProcess.spawnSync("bash", ["-c", step.run], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_REF: "refs/heads/kh-bisect/abc1234", GITHUB_OUTPUT: output },
    });
    expect(result.status, result.stderr).toBe(0);
    const outputs = Object.fromEntries(
      NodeFS.readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    expect(
      JSON.parse(outputs.jobs!),
      "ASSERTION: CI runs the selected job through its real command",
    ).toEqual(["test_server"]);
    expect(JSON.parse(outputs.test_server!)).toEqual({ include: [{ shard: 4, total: 6 }] });
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});
