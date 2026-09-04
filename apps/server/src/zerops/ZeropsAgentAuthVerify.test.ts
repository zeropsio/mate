import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import { layerVerifyAgentAuth } from "./ZeropsAgentAuth.ts";
import {
  parseClaudeAuthStatus,
  parseCodexLoginStatus,
  spawnAgentAuthProbe,
  verifyAgentAuth,
  type AgentAuthProbeOutcome,
  type AgentAuthProbeSpawn,
} from "./ZeropsAgentAuthVerify.ts";

describe("parseClaudeAuthStatus", () => {
  it("reads loggedIn:true as authenticated", () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}')).toBe(
      "authenticated",
    );
  });

  it("reads loggedIn:false as unauthenticated", () => {
    expect(parseClaudeAuthStatus('{"loggedIn":false,"authMethod":"none"}')).toBe("unauthenticated");
  });

  it("reads empty output as unknown", () => {
    expect(parseClaudeAuthStatus("")).toBe("unknown");
  });

  it("reads unparsable JSON as unknown", () => {
    expect(parseClaudeAuthStatus("not json at all")).toBe("unknown");
  });

  it("reads a document missing loggedIn as unknown", () => {
    expect(parseClaudeAuthStatus('{"authMethod":"claude.ai"}')).toBe("unknown");
  });

  it("reads a non-boolean loggedIn as unknown", () => {
    expect(parseClaudeAuthStatus('{"loggedIn":"yes"}')).toBe("unknown");
  });

  it("reads a JSON array as unknown", () => {
    expect(parseClaudeAuthStatus("[1,2,3]")).toBe("unknown");
  });

  it("tolerates surrounding whitespace/newlines", () => {
    expect(parseClaudeAuthStatus('\n  {"loggedIn":true}  \n')).toBe("authenticated");
  });
});

describe("parseCodexLoginStatus", () => {
  it('reads "Not logged in" as unauthenticated', () => {
    expect(parseCodexLoginStatus("Not logged in\n", "")).toBe("unauthenticated");
  });

  it('reads "Logged in using ChatGPT" as authenticated', () => {
    expect(parseCodexLoginStatus("Logged in using ChatGPT\n", "")).toBe("authenticated");
  });

  it('reads "Logged in using API key" as authenticated (method name is not gated)', () => {
    expect(parseCodexLoginStatus("Logged in using API key\n", "")).toBe("authenticated");
  });

  it("checks stderr too, in case Codex writes status there", () => {
    expect(parseCodexLoginStatus("", "Not logged in\n")).toBe("unauthenticated");
  });

  it("reads unrecognized text as unknown rather than guessing", () => {
    expect(parseCodexLoginStatus("something unexpected\n", "")).toBe("unknown");
  });

  it("reads empty output as unknown", () => {
    expect(parseCodexLoginStatus("", "")).toBe("unknown");
  });
});

const outcome = (partial: Partial<AgentAuthProbeOutcome>): AgentAuthProbeOutcome => ({
  stdout: "",
  stderr: "",
  code: 0,
  ...partial,
});

/** Records every (command, args) it was called with and answers with the canned outcome. */
const makeFakeSpawn = (answer: AgentAuthProbeOutcome) => {
  const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const spawn: AgentAuthProbeSpawn = (command, args) => {
    calls.push({ command, args });
    return Effect.succeed(answer);
  };
  return { spawn, calls };
};

describe("verifyAgentAuth", () => {
  it.effect("claude-code: loggedIn true -> authenticated, spawns `claude auth status`", () =>
    Effect.gen(function* () {
      const fake = makeFakeSpawn(outcome({ stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' }));
      const status = yield* verifyAgentAuth("claude-code", fake.spawn);
      expect(status).toBe("authenticated");
      expect(fake.calls).toEqual([{ command: "claude", args: ["auth", "status"] }]);
    }),
  );

  it.effect("claude-code: loggedIn false -> unauthenticated", () =>
    Effect.gen(function* () {
      const fake = makeFakeSpawn(outcome({ stdout: '{"loggedIn":false,"authMethod":"none"}' }));
      const status = yield* verifyAgentAuth("claude-code", fake.spawn);
      expect(status).toBe("unauthenticated");
    }),
  );

  it.effect("claude-code: a spawn outcome with no usable output (binary missing) -> unknown", () =>
    Effect.gen(function* () {
      const fake = makeFakeSpawn(outcome({ stdout: "", stderr: "", code: null }));
      const status = yield* verifyAgentAuth("claude-code", fake.spawn);
      expect(status).toBe("unknown");
    }),
  );

  it.effect("codex: spawns `codex login status` and reads the text answer", () =>
    Effect.gen(function* () {
      const fake = makeFakeSpawn(outcome({ stdout: "Logged in using ChatGPT\n" }));
      const status = yield* verifyAgentAuth("codex", fake.spawn);
      expect(status).toBe("authenticated");
      expect(fake.calls).toEqual([{ command: "codex", args: ["login", "status"] }]);
    }),
  );

  it.effect("codex: Not logged in -> unauthenticated", () =>
    Effect.gen(function* () {
      const fake = makeFakeSpawn(outcome({ stdout: "Not logged in\n" }));
      const status = yield* verifyAgentAuth("codex", fake.spawn);
      expect(status).toBe("unauthenticated");
    }),
  );
});

// `spawnAgentAuthProbe` against a REAL ProcessRunner — proves the
// binary-missing / spawn-failure path actually collapses to the empty
// outcome (and therefore `unknown`), not just that the pure parsers do,
// mirroring ZeropsCli.test.ts's own real-process stub pattern.
const liveDependencies = Layer.mergeAll(
  ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
);

const withProcessRunner = <A, E>(
  use: (runner: ProcessRunner.ProcessRunner["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const runner = yield* ProcessRunner.ProcessRunner;
    return yield* use(runner);
  }).pipe(Effect.provide(liveDependencies));

describe("spawnAgentAuthProbe (real ProcessRunner)", () => {
  it.effect("passes real stdout/stderr/code through untouched", () =>
    withProcessRunner((runner) =>
      Effect.gen(function* () {
        const spawn = spawnAgentAuthProbe(runner, process.cwd());
        const outcomeResult = yield* spawn(process.execPath, [
          "-e",
          'process.stdout.write("hello"); process.exitCode = 0',
        ]);
        expect(outcomeResult.stdout).toBe("hello");
        expect(outcomeResult.code).toBe(0);
      }),
    ),
  );

  it.effect("reduces a missing binary to the empty outcome (unknown once parsed)", () =>
    withProcessRunner((runner) =>
      Effect.gen(function* () {
        const spawn = spawnAgentAuthProbe(runner, process.cwd());
        const outcomeResult = yield* spawn("definitely-not-a-real-binary-agent-cli", [
          "auth",
          "status",
        ]);
        expect(outcomeResult).toEqual({ stdout: "", stderr: "", code: null });
        expect(parseClaudeAuthStatus(outcomeResult.stdout)).toBe("unknown");
      }),
    ),
  );
});

// Audit C3: the provider registry's own `refreshInstance` used to run
// alongside this probe as a best-effort picker-cache warm — dropped; the
// picker's own cache may lag, spec-mate.md §8.1.
describe("layerVerifyAgentAuth", () => {
  it.effect("verification spawns only the CLI status command", () =>
    Effect.gen(function* () {
      const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
      const spawn: AgentAuthProbeSpawn = (command, args) => {
        calls.push({ command, args });
        return Effect.succeed({ stdout: '{"loggedIn":true}', stderr: "", code: 0 });
      };
      const status = yield* layerVerifyAgentAuth(spawn)("claude-code");
      expect(status).toBe("authenticated");
      expect(calls).toEqual([{ command: "claude", args: ["auth", "status"] }]);
    }),
  );
});
