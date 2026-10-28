import { makeAccountStore, type HqWrites } from "@t3tools/client-runtime/data";
import { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { AtomRegistry } from "effect/reactivity";
import { accountOperations } from "./accountOperations";
import { openAccountLifetime, closeAccountLifetime } from "./accountLifetime";
import { holdHqWrites } from "./hqWrites";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { gitEnvironmentSetup, useSetUpEnvironment } from "./setUpEnvironment";

afterEach(() => {
  useSetUpEnvironment.setState({ asked: null });
});

describe("useSetUpEnvironment — a stage or a production asked for from the left menu", () => {
  it.each([
    { tier: "stage", role: "stage" },
    { tier: "production", role: "prod" },
  ] as const)("hands the projects page the $tier's form once", ({ tier, role }) => {
    useSetUpEnvironment.getState().ask("grp-a", tier);
    expect(useSetUpEnvironment.getState().take()).toEqual({ groupId: "grp-a", role });
    // Taken, it is gone: the form opens once per ask, never again on the next visit.
    expect(useSetUpEnvironment.getState().take()).toBeNull();
  });

  it("keeps only the last ask", () => {
    useSetUpEnvironment.getState().ask("grp-a", "stage");
    useSetUpEnvironment.getState().ask("grp-b", "production");
    expect(useSetUpEnvironment.getState().take()).toEqual({ groupId: "grp-b", role: "prod" });
  });
});

it("Git setup sends remotes first and adds a fixed direct target without recipe, deploy token, PR, tag or push", async () => {
  const run = vi.fn(
    async (_intent: Parameters<import("./accountOperations").AccountOperations["run"]>[0]) =>
      undefined,
  );
  const runGitCandidate = vi.fn(async () => ({
    ok: false as const,
    reason: "Host refused the token.",
  }));
  const setup = gitEnvironmentSetup({
    orgId: "org",
    appId: "app",
    hqProjectId: "hq",
    operations: {
      run: run as import("./accountOperations").AccountOperations["run"],
      runGitCandidate,
    },
  });
  expect(await setup.connect("code", "https://github.com/acme/shop", "candidate", false)).toEqual({
    ok: false,
    reason: "Host refused the token.",
  });
  expect(runGitCandidate).toHaveBeenCalledExactlyOnceWith(
    {
      kind: "connect-git-remote",
      orgId: "org",
      appId: "app",
      hqProjectId: "hq",
      repo: "code",
      url: "https://github.com/acme/shop",
    },
    "candidate",
  );
  expect(run).not.toHaveBeenCalled();
  await setup.preview("main");
  expect(run.mock.calls[0]?.[0]).toEqual({
    kind: "preview-git-environment",
    orgId: "org",
    appId: "app",
    hqProjectId: "hq",
    request: { target: { kind: "git", branch: "main", delivery: "direct" } },
  });
  const request = {
    tier: "production" as const,
    name: "Shop - production",
    target: { kind: "git" as const, branch: "main", delivery: "direct" as const },
    adoption: [
      {
        repo: "code",
        remote: { url: "https://github.com/acme/shop", repositoryId: "17" },
        branch: "main",
        mainHead: "a".repeat(40),
        remoteHead: "b".repeat(40),
        changedFiles: 23,
        seed: false,
      },
    ],
  };
  await setup.add(request);
  expect(run.mock.calls.map((call) => call[0])).toEqual([
    {
      kind: "preview-git-environment",
      orgId: "org",
      appId: "app",
      hqProjectId: "hq",
      request: { target: { kind: "git", branch: "main", delivery: "direct" } },
    },
    { kind: "add-git-environment", orgId: "org", appId: "app", hqProjectId: "hq", request },
  ]);
});

it("The account candidate bridge uses the existing coordinator once and never records plaintext", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const scope = "hq:org:hq-apps" as const;
  openAccountLifetime("viewer");
  for (const key of ["hq:org" as const, scope]) {
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "attempt" } });
  }
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope, generation: 1 }],
    reset: true,
    rows: [
      {
        family: "hqApp",
        id: "app",
        revision: { kind: "hq", incarnation: "i", revision: 1 },
        value: {
          id: "app",
          name: "Shop",
          can: { structure: { allow: true } },
          projectIds: [],
          environments: [],
          births: [],
          contents: { empty: false, deletingProjectIds: [] },
        },
      },
    ],
    removals: [],
  });
  const probe = {
    ok: true as const,
    remote: {
      url: "https://github.com/acme/shop",
      repositoryId: "17",
      keptAt: "2026-10-13T10:00:00Z",
      keptBy: "viewer",
      expiresAt: null,
      invalidSince: null,
    },
  };
  const write = vi.fn(async (requestId: string, intent: unknown, token?: string) => {
    expect(token).toBe("candidate-marker");
    expect(JSON.stringify(intent)).not.toContain("candidate-marker");
    return {
      requestId,
      operationId: requestId,
      executor: "hq" as const,
      affected: [],
      handles: [requestId],
      acceptance: { kind: "accepted" as const, result: { probe } },
      outcome: { kind: "succeeded" as const, evidence: "HQ verified the remote." },
    };
  });
  const release = holdHqWrites("org", { gitTargetWrite: write } as unknown as HqWrites, "hq");
  try {
    const operations = accountOperations(
      store,
      registry,
      new ZeropsApiClient(),
      () => () => {},
      () => {},
      async () => true,
    );
    expect(
      await operations.runGitCandidate!(
        {
          kind: "connect-git-remote",
          orgId: "org",
          appId: "app",
          hqProjectId: "hq",
          repo: "code",
          url: probe.remote.url,
        },
        "candidate-marker",
      ),
    ).toEqual(probe);
    expect(write).toHaveBeenCalledOnce();
    expect(store.state().operations.size).toBe(1);
    expect(JSON.stringify([...store.state().operations.values()])).not.toContain(
      "candidate-marker",
    );
  } finally {
    release();
    store.close();
    registry.dispose();
    closeAccountLifetime();
  }
});
