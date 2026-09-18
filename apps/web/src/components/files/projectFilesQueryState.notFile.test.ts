import { EnvironmentId, ProjectReadFileError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const projectMocks = vi.hoisted(() => ({
  listEntries: vi.fn(),
  optimisticFile: vi.fn(),
  readFile: vi.fn(),
}));

const atomHooks = vi.hoisted(() => ({
  registry: null as {
    get(atom: object): unknown;
    refresh(atom: object): void;
  } | null,
}));

const reactHooks = vi.hoisted(() => {
  let cursor = 0;
  let refs: Array<{ current: unknown }> = [];
  const nextIndex = () => cursor++;

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      cursor = 0;
      refs = [];
    },
    useCallback<A>(callback: A): A {
      nextIndex();
      return callback;
    },
    useEffect(effect: () => void): void {
      nextIndex();
      effect();
    },
    useRef<A>(initialValue: A): { current: A } {
      const index = nextIndex();
      refs[index] ??= { current: initialValue };
      return refs[index] as { current: A };
    },
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomRefresh: (atom: object) => () => {
    atomHooks.registry?.refresh(atom);
  },
  useAtomValue: (atom: object) => atomHooks.registry?.get(atom),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: reactHooks.useCallback,
    useEffect: reactHooks.useEffect,
    useRef: reactHooks.useRef,
  };
});

vi.mock("~/state/projects", () => ({
  projectEnvironment: projectMocks,
}));

vi.mock("~/state/queries", () => ({
  useProjectPathSearch: vi.fn(),
}));

import { useProjectFileQuery } from "./projectFilesQueryState";

const environmentId = EnvironmentId.make("environment-1");

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("project file query failures", () => {
  beforeEach(() => {
    projectMocks.listEntries.mockReset();
    projectMocks.optimisticFile.mockReset();
    projectMocks.readFile.mockReset();
    reactHooks.reset();
  });

  it("reports a directory named like an image as not a file", async () => {
    const readAtom = Atom.make(
      Effect.fail(
        new ProjectReadFileError({
          cwd: "/repo",
          relativePath: "assets.png",
          failure: "path_not_file",
        }),
      ),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;

    try {
      await flushEffects();
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", "assets.png");
      expect(query.isNotFile).toBe(true);
      expect(query.data).toBeNull();
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });

  it("reports a directory read as not a file", async () => {
    const readAtom = Atom.make(
      Effect.fail(
        new ProjectReadFileError({
          cwd: "/repo",
          relativePath: ".agents/skills",
          failure: "path_not_file",
        }),
      ),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(readAtom);
    projectMocks.readFile.mockReturnValue(readAtom);
    projectMocks.optimisticFile.mockReturnValue(Atom.make(null));
    atomHooks.registry = registry;

    try {
      await flushEffects();
      reactHooks.beginRender();
      const query = useProjectFileQuery(environmentId, "/repo", ".agents/skills");
      expect(query.isNotFile).toBe(true);
      expect(query.data).toBeNull();
    } finally {
      unmount();
      registry.dispose();
      atomHooks.registry = null;
    }
  });
});
