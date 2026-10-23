// @vitest-environment happy-dom
import type { EnvironmentId } from "@t3tools/contracts";
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
    services: [] as Array<{ hostname: string; group: string }>,
    crew: null as unknown,
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

const ENVIRONMENT = "mate" as EnvironmentId;

beforeEach(() => {
  vi.useFakeTimers();
  mate.statuses.clear();
  mate.atoms.clear();
  mate.services = [{ hostname: "apidev", group: "runtimes" }];
  mate.crew = null;
});
afterEach(() => vi.useRealTimers());

/** Renders the hook for a conversation and hands back what it read last. */
async function readRepositories(
  crew: { crew: string; crewmate: string; stint: number } | null,
  look: (latest: () => ReadonlyArray<DiffRepositoryRead> | null) => Promise<void>,
  lease: { alias: string; pool: string; branch: string | null } | null = null,
) {
  let latest: ReadonlyArray<DiffRepositoryRead> | null = null;
  function Probe() {
    latest = useDiffRepositories(ENVIRONMENT, "/var/www", crew, lease).reads;
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
    { alias: "webpool-3", pool: "webpool", branch: "feat-x" },
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
