// @vitest-environment happy-dom
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AsyncResult, Atom } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { shownDiff, type DiffRepositoryRead } from "./DiffPanel.logic";
import { useDiffRepositories } from "./useDiffRepositories";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mate = vi.hoisted(() => {
  /** What git says of a folder: a repository on `refName`, none, or not said yet (`undefined`). */
  const statuses = new Map<string, { isRepo: boolean; refName?: string } | undefined>();
  const atoms = new Map<string, unknown>();
  return {
    statuses,
    atoms,
    services: [] as Array<{ hostname: string; group: string; type?: string }>,
    crew: null as unknown,
    /** The thread's lifecycle, whose last envelope may key a migrated part's pair by its pool. */
    lifecycle: undefined as unknown,
  };
});

/** A checkout's status as the Git page reads it. */
const status = (refName: string) => ({
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName,
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  aheadOfDefaultCount: 1,
  pr: null,
});

vi.mock("../state/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/workspace")>()),
  vcsStatus: ({ input: { cwd } }: { input: { cwd: string } }) => {
    let atom = mate.atoms.get(cwd);
    if (atom === undefined) {
      const said = mate.statuses.get(cwd);
      atom = Atom.make(
        said === undefined
          ? AsyncResult.initial()
          : AsyncResult.success(said.isRepo ? status(said.refName ?? "main") : { isRepo: false }),
      );
      mate.atoms.set(cwd, atom);
    }
    return atom;
  },
}));
vi.mock("../zerops/useProjectTopology", () => ({
  useProjectTopology: () => ({ view: { services: mate.services }, error: undefined }),
}));
vi.mock("../state/zerops", () => ({
  zeropsFeeds: { crew: () => Atom.make(mate.crew) },
}));
vi.mock("../zerops/useZeropsFeeds", () => ({
  useZeropsLifecycle: () => mate.lifecycle,
}));

const ENVIRONMENT = "mate" as EnvironmentId;
const THREAD = "thread-1" as ThreadId;

beforeEach(() => {
  vi.useFakeTimers();
  mate.statuses.clear();
  mate.atoms.clear();
  mate.services = [{ hostname: "apidev", group: "runtimes" }];
  mate.crew = null;
  mate.lifecycle = undefined;
});
afterEach(() => vi.useRealTimers());

/** Renders the hook for a conversation and hands back what it read last. */
async function readRepositories(
  crew: { crew: string; crewmate: string; stint: number } | null,
  look: (latest: () => ReadonlyArray<DiffRepositoryRead> | null) => Promise<void>,
  leases: ReadonlyArray<{ alias: string; pool: string; branch: string | null }> = [],
) {
  let latest: ReadonlyArray<DiffRepositoryRead> | null = null;
  function Probe() {
    latest = useDiffRepositories(ENVIRONMENT, "/var/www", crew, leases, THREAD).reads;
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(() => root.render(<Probe />));
    await look(() => latest);
  } finally {
    await act(() => root.unmount());
  }
}

it("while a checkout's git status is still read, however long, Diff says it is reading, never that there is no code", async () => {
  mate.statuses.set("/var/www", { isRepo: false });
  await readRepositories(null, async (latest) => {
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(shownDiff(latest(), { kind: "unstaged" })).toEqual({ kind: "reading" });
  });
});

it("a crewmate's conversation shows the crewmate's own copy of its service's checkout, on its crew branch", async () => {
  mate.statuses.set("/var/www/apidev", { isRepo: true, refName: "main" });
  mate.statuses.set("/var/www/apidev/.crew/backend", { isRepo: true, refName: "crew/backend" });
  mate.crew = {
    state: "known",
    freshness: { kind: "fresh" },
    value: {
      status: "applied",
      crewmates: [{ handle: "backend", kind: "writer", host: "apidev" }],
    },
  };
  await readRepositories({ crew: "shop", crewmate: "backend", stint: 1 }, async (latest) => {
    expect(
      latest()?.map(({ repository, status }) => ({
        cwd: repository.cwd,
        branch: typeof status === "object" ? status.refName : status,
      })),
    ).toEqual([{ cwd: "/var/www/apidev/.crew/backend", branch: "crew/backend" }]);
  });
});

it("a thread bound to a lease diffs that lease's repository alone, named by its pool and branch", async () => {
  mate.statuses.set("/var/www/apidev", { isRepo: true, refName: "main" });
  mate.statuses.set("/var/www/webpool-3", { isRepo: true, refName: "feat-x" });
  await readRepositories(
    null,
    async (latest) => {
      expect(latest()?.map(({ repository }) => repository)).toEqual([
        { name: "webpool · feat-x", cwd: "/var/www/webpool-3" },
      ]);
    },
    [{ alias: "webpool-3", pool: "webpool", branch: "feat-x" }],
  );
});

it("a thread bound to a lease of a branch held on several pools diffs every lease of it, each named by its pool and branch", async () => {
  mate.statuses.set("/var/www/apidev", { isRepo: true, refName: "main" });
  mate.statuses.set("/var/www/webpool-3", { isRepo: true, refName: "feat-x" });
  mate.statuses.set("/var/www/hqpool-2", { isRepo: true, refName: "feat-x" });
  await readRepositories(
    null,
    async (latest) => {
      expect(latest()?.map(({ repository }) => repository)).toEqual([
        { name: "webpool · feat-x", cwd: "/var/www/webpool-3" },
        { name: "hqpool · feat-x", cwd: "/var/www/hqpool-2" },
      ]);
    },
    [
      { alias: "webpool-3", pool: "webpool", branch: "feat-x" },
      { alias: "hqpool-2", pool: "hqpool", branch: "feat-x" },
    ],
  );
});

it("a thread bound to no lease diffs the Mate's checkouts, never another thread's lease", async () => {
  mate.statuses.set("/var/www/apidev", { isRepo: true, refName: "main" });
  mate.statuses.set("/var/www/webpool-3", { isRepo: true, refName: "feat-x" });
  await readRepositories(null, async (latest) => {
    expect(latest()?.map(({ repository }) => repository)).toEqual([
      { name: "apidev", cwd: "/var/www/apidev" },
    ]);
  });
});

it("a part migrated to a dev pool is never read as a checkout: Diff asks git nothing of its stage", async () => {
  mate.services = [
    { hostname: "apppool", group: "infrastructure", type: "swarm@1" },
    { hostname: "appstage", group: "runtimes", type: "bun@1.3" },
    { hostname: "apidev", group: "runtimes", type: "nodejs@22" },
  ];
  mate.lifecycle = {
    state: "known",
    value: {
      envelope: {
        services: [
          {
            hostname: "apppool",
            runtimeClass: "pool",
            stages: [{ hostname: "appstage", setup: "prod" }],
          },
        ],
      },
    },
  };
  mate.statuses.set("/var/www/apidev", { isRepo: true, refName: "main" });
  await readRepositories(null, async (latest) => {
    expect(latest()?.map(({ repository }) => repository)).toEqual([
      { name: "apidev", cwd: "/var/www/apidev" },
    ]);
    expect(mate.atoms.has("/var/www/appstage")).toBe(false);
  });
});
