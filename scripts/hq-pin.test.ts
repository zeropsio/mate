// @effect-diagnostics nodeBuiltinImport:off -- exercises workflow steps against disposable Git commits.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { parse } from "yaml";

const root = NodePath.resolve(import.meta.dirname, "..");
let fixture: string;
const git = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

beforeAll(() => {
  fixture = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-hq-pin-"));
});
afterAll(() => {
  NodeFS.rmSync(fixture, { recursive: true, force: true });
});

it("Decision: every z3 commit records one full mate-hq SHA; CI, Signal, State Smoke and local scenarios build exactly it.", () => {
  const hq = NodePath.join(fixture, "hq");
  const z3 = NodePath.join(fixture, "z3");
  for (const dir of [hq, z3]) {
    NodeFS.mkdirSync(dir);
    git(dir, "init", "-q");
    git(dir, "config", "user.name", "Scenario fixture");
    git(dir, "config", "user.email", "fixture@example.invalid");
  }
  NodeFS.symlinkSync(NodePath.join(root, "scripts"), NodePath.join(z3, "scripts"));
  NodeFS.symlinkSync(hq, NodePath.join(z3, "mate-hq"));
  const z3Commits: string[] = [];
  const hqCommits: string[] = [];
  for (const build of ["first HQ build", "second HQ build"]) {
    NodeFS.writeFileSync(NodePath.join(hq, "build"), build);
    git(hq, "add", "build");
    git(hq, "commit", "-qm", build);
    const hqSha = git(hq, "rev-parse", "HEAD");
    hqCommits.push(hqSha);
    NodeFS.writeFileSync(NodePath.join(z3, ".mate-hq-ref"), `${hqSha}\n`);
    git(z3, "add", ".mate-hq-ref");
    git(z3, "commit", "-qm", `adopt ${build}`);
    z3Commits.push(git(z3, "rev-parse", "HEAD"));
  }
  const ci = parse(NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"));
  const signal = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/signal.yml"), "utf8"),
  );
  const outcomes = z3Commits.map((commit) => {
    git(z3, "checkout", "-q", "--detach", commit);
    const output = NodePath.join(fixture, "output");
    const run = (command: string) =>
      NodeChildProcess.spawnSync("bash", ["-eu", "-c", command], {
        cwd: z3,
        encoding: "utf8",
        env: {
          ...process.env,
          BRANCH: "main",
          GITHUB_REF: "refs/heads/main",
          GITHUB_EVENT_NAME: "push",
          GITHUB_OUTPUT: output,
        },
      });
    const guard = ci.jobs.verification.steps.find(
      (step: { name: string }) => step.name === "Check mate-hq ref for verified promotion",
    );
    const guardStatus = run(guard?.run ?? ":").status;
    const builds = [ci.jobs.state_smoke, signal.jobs.chat_scenarios, signal.jobs.classify].map(
      (job) => {
        const resolve = job.steps.find(
          (step: { name: string }) => step.name === "Resolve the mate-hq ref",
        );
        const checkout = job.steps.find(
          (step: { name: string }) => step.name === "Checkout mate-hq",
        );
        expect(checkout.with.ref).toBe("${{ steps.hq_ref.outputs.ref }}");
        NodeFS.writeFileSync(output, "");
        const result = run(resolve.run);
        expect(result.status, result.stderr).toBe(0);
        const ref = NodeFS.readFileSync(output, "utf8").trim().replace(/^ref=/u, "");
        return { ref, build: git(hq, "show", `${ref}:build`) };
      },
    );
    return { guardStatus, builds };
  });
  expect(outcomes).toEqual([
    {
      guardStatus: 0,
      builds: Array.from({ length: 3 }, () => ({ ref: hqCommits[0], build: "first HQ build" })),
    },
    {
      guardStatus: 0,
      builds: Array.from({ length: 3 }, () => ({ ref: hqCommits[1], build: "second HQ build" })),
    },
  ]);
  for (const invalid of [undefined, "main", hqCommits[0]!.slice(0, 12), "Z".repeat(40)]) {
    const pin = NodePath.join(z3, ".mate-hq-ref");
    if (invalid === undefined) NodeFS.rmSync(pin);
    else NodeFS.writeFileSync(pin, `${invalid}\n`);
    for (const job of [ci.jobs.state_smoke, signal.jobs.chat_scenarios, signal.jobs.classify]) {
      const resolve = job.steps.find(
        (step: { name: string }) => step.name === "Resolve the mate-hq ref",
      );
      const result = NodeChildProcess.spawnSync("bash", ["-eu", "-c", resolve.run], {
        cwd: z3,
        encoding: "utf8",
        env: { ...process.env, BRANCH: "feature", GITHUB_OUTPUT: NodePath.join(fixture, "output") },
      });
      expect(result.status, `invalid pin ${invalid} must be refused`).not.toBe(0);
    }
  }
});

it("Decision: on z3 `main` (and in promotion), the recorded SHA must be contained in mate-hq `main`; a SHA not on mate-hq main is refused with both SHAs named.", () => {
  const hq = NodePath.join(fixture, "promotion-hq");
  const z3 = NodePath.join(fixture, "promotion-z3");
  NodeFS.mkdirSync(hq);
  NodeFS.mkdirSync(z3);
  git(hq, "init", "-q");
  git(hq, "config", "user.name", "Scenario fixture");
  git(hq, "config", "user.email", "fixture@example.invalid");
  NodeFS.writeFileSync(NodePath.join(hq, "build"), "base");
  git(hq, "add", "build");
  git(hq, "commit", "-qm", "base");
  const base = git(hq, "rev-parse", "HEAD");
  git(hq, "checkout", "-qb", "side");
  NodeFS.writeFileSync(NodePath.join(hq, "build"), "unpublished");
  git(hq, "commit", "-qam", "unpublished");
  const unpublished = git(hq, "rev-parse", "HEAD");
  git(hq, "checkout", "-q", "--detach", base);
  NodeFS.writeFileSync(NodePath.join(hq, "build"), "main");
  git(hq, "commit", "-qam", "main");
  const main = git(hq, "rev-parse", "HEAD");
  NodeFS.symlinkSync(hq, NodePath.join(z3, "mate-hq"));
  NodeFS.symlinkSync(NodePath.join(root, "scripts"), NodePath.join(z3, "scripts"));
  const ci = parse(NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"));
  const guard = ci.jobs.verification.steps.find(
    (step: { name: string }) => step.name === "Check mate-hq ref for verified promotion",
  );
  for (const branch of ["main", "kh-next"]) {
    for (const pin of [base, main, unpublished]) {
      NodeFS.writeFileSync(NodePath.join(z3, ".mate-hq-ref"), `${pin}\n`);
      const result = NodeChildProcess.spawnSync("bash", ["-eu", "-c", guard.run], {
        cwd: z3,
        encoding: "utf8",
        env: { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_REF: `refs/heads/${branch}` },
      });
      expect(result.status, `${branch} ${pin}: ${result.stderr}`).toBe(pin === unpublished ? 1 : 0);
      if (pin === unpublished) {
        expect(result.stdout + result.stderr).toContain(pin);
        expect(result.stdout + result.stderr).toContain(main);
      }
    }
  }
  const reject = ci.jobs.prepare.steps.find(
    (step: { name: string }) => step.name === "Reject invalid mate-hq pin",
  );
  for (const [outcome, expected] of [
    ["success", 0],
    ["failure", 1],
    ["", 1],
  ] as const) {
    const result = NodeChildProcess.spawnSync("bash", ["-eu", "-c", reject.run], {
      cwd: z3,
      env: { ...process.env, HQ_REF_VALID: outcome },
    });
    expect(result.status, `promotion with guard outcome ${outcome}`).toBe(expected);
  }
});

it("Scenario producers complete the HQ contract preflight before admitting their shards", () => {
  const ci = parse(NodeFS.readFileSync(NodePath.join(root, ".github/workflows/ci.yml"), "utf8"));
  const signal = parse(
    NodeFS.readFileSync(NodePath.join(root, ".github/workflows/signal.yml"), "utf8"),
  );
  expect(ci.jobs.state_smoke.needs).toContain("prepare");
  expect(signal.jobs.chat_scenarios.needs).toContain("chat_bundle");
  for (const producer of [ci.jobs.prepare, signal.jobs.chat_bundle]) {
    expect(
      producer.steps.some(
        (step: { name: string }) => step.name === "Preflight the pinned mate-hq contract",
      ),
    ).toBe(true);
  }
  expect(ci.jobs.prepare.outputs.hq_ref).toBe("${{ steps.hq_ref.outputs.ref }}");
  expect(ci.jobs.state_smoke.env.MATE_HQ_PREFLIGHT_SHA).toBe("${{ needs.prepare.outputs.hq_ref }}");
  expect(signal.jobs.chat_bundle.outputs.hq_ref).toBe("${{ steps.hq_ref.outputs.ref }}");
  for (const job of [signal.jobs.chat_scenarios, signal.jobs.classify])
    expect(job.env.MATE_HQ_PREFLIGHT_SHA).toBe("${{ needs.chat_bundle.outputs.hq_ref }}");
});
