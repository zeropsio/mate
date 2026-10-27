import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as ZeropsGitRemoteProbe from "./ZeropsGitRemoteProbe.ts";

const liveDependencies = Layer.mergeAll(
  ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
);

/** A stand-in for `git`: `node -e <script>` ignores the `ls-remote` args. */
const stub = (script: string) =>
  ZeropsGitRemoteProbe.make({ command: process.execPath, baseArgs: ["-e", script] });

const run = <A, E>(
  probe: ReturnType<typeof ZeropsGitRemoteProbe.make>,
  use: (service: ZeropsGitRemoteProbe.ZeropsGitRemoteProbe["Service"]) => Effect.Effect<A, E>,
) => probe.pipe(Effect.flatMap(use), Effect.provide(liveDependencies));

const REF = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d\\trefs/heads/";

describe("what the probe reports", () => {
  it.effect("a remote that answers, and how many branches it advertised", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(`process.stdout.write("${REF}main\\n${REF}feature/invoices\\n")`),
        (probe) => probe.probe({ cwd: process.cwd() }),
      );
      expect(result).toEqual({ reachable: true, remote: "origin", refCount: 2, detail: null });
    }),
  );

  it.effect("a remote that answers with nothing — an empty repository is reachable", () =>
    Effect.gen(function* () {
      const result = yield* run(stub(`process.stdout.write("")`), (probe) =>
        probe.probe({ cwd: process.cwd() }),
      );
      expect(result).toEqual({ reachable: true, remote: "origin", refCount: 0, detail: null });
    }),
  );

  it.effect("a remote that refuses, with what it said — a success, not an error", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(
          `process.stderr.write("remote: Repository not found.\\nfatal: authentication failed\\n"); process.exit(128)`,
        ),
        (probe) => probe.probe({ cwd: process.cwd() }),
      );
      expect(result.reachable).toBe(false);
      // The server's own words, not git's generic tail.
      expect(result.detail).toBe("remote: Repository not found.");
    }),
  );

  it.effect("the remote the caller named, rather than origin", () =>
    Effect.gen(function* () {
      const result = yield* run(stub(`process.stdout.write("")`), (probe) =>
        probe.probe({ cwd: process.cwd(), remote: "upstream" }),
      );
      expect(result.remote).toBe("upstream");
    }),
  );

  it.effect("a probe that could not run at all is an error, not an unreachable remote", () =>
    Effect.gen(function* () {
      const error = yield* run(
        ZeropsGitRemoteProbe.make({ command: "definitely-not-a-real-git", baseArgs: [] }),
        (probe) => Effect.flip(probe.probe({ cwd: process.cwd() })),
      );
      expect(error._tag).toBe("ZeropsGitRemoteProbeError");
    }),
  );
});

describe("reading git's answer", () => {
  it.each([
    {
      name: "the server's own line, wherever it is",
      stderr: "fatal: x\nremote: gone\n",
      expected: "remote: gone",
    },
    {
      name: "the first line when there is no remote line",
      stderr: "fatal: x\ny\n",
      expected: "fatal: x",
    },
    { name: "nothing at all", stderr: "   \n\n", expected: "the remote refused" },
  ])("takes $name", ({ stderr, expected }) => {
    expect(ZeropsGitRemoteProbe.probeDiagnostic(stderr)).toBe(expected);
  });

  it("caps a pathological diagnostic at a length a row can carry", () => {
    expect(ZeropsGitRemoteProbe.probeDiagnostic(`remote: ${"x".repeat(500)}`)).toHaveLength(200);
  });

  it.each([
    { name: "one ref per line", stdout: "a\tb\nc\td\n", expected: 2 },
    { name: "a blank tail", stdout: "a\tb\n\n\n", expected: 1 },
    { name: "no refs", stdout: "", expected: 0 },
  ])("counts $name", ({ stdout, expected }) => {
    expect(ZeropsGitRemoteProbe.probeRefCount(stdout)).toBe(expected);
  });
});
