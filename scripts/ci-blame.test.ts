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
  expect(selection.matrices.test_web).toEqual({ include: [{ shard: 2, total: 2 }] });
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

it("Scenario blame builds its bundle and runs exactly the failed scenario shard", () => {
  const selection = blameSelection(
    "refs/heads/kh-bisect/abc1234",
    "Test Web Scenarios (C shard 3)\n",
  );
  expect(selection.selected.sort()).toEqual(["changes", "chat_bundle", "chat_scenarios"]);
  expect(selection.matrices.chat_scenarios!.include).toEqual([
    { name: "C shard 3", command: "node scripts/chat-gate.ts --verbose --stages C --shard 3/4" },
  ]);
});

it("Summary failures rerun their failed dependencies without selecting unrelated suites", () => {
  const selection = blameSelection(
    "refs/heads/kh-bisect/abc1234",
    "Test\nTest Scripts 1\nRelease Smoke\nCheck\n",
  );
  expect(selection.selected.sort()).toEqual([
    "changes",
    "check",
    "release_smoke",
    "test",
    "test_scripts",
  ]);
  expect(selection.matrices.test_hq!.include).toEqual([]);
  expect(workflow.jobs.test.steps.at(-1).run).toContain("needs.prepare.outputs.blame == 'true'");
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
      [1, 2, 3, 4].map((shard) => ({ shard, total: 4 })),
    );
    expect(selection.matrices.chat_scenarios!.include).toHaveLength(7);
  },
);

it("Bisect refs without a selection retain full CI and unknown selections fail explicitly", () => {
  expect(blameSelection("refs/heads/kh-bisect/abc1234", undefined).narrowed).toBe(false);
  expect(() => blameSelection("refs/heads/kh-bisect/abc1234", "unknown\n")).toThrow(
    "No known failed CI job",
  );
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
    expect(JSON.parse(outputs.test_server!)).toEqual({ include: [{ shard: 4, total: 4 }] });
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});
