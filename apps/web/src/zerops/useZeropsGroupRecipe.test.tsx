/**
 * The recipe a new Mate starts from, read off the group repo's `main` as the person: a file that
 * is not there is no recipe, a read that failed is not — and neither is a read that could not go
 * out yet.
 */
import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsGroupRecipe, type GroupRecipe } from "./useZeropsGroupRecipe";

/** Whether this tab can read Gitea now, and each read of the recipe still waiting on its answer. */
const gitea = vi.hoisted(() => ({
  readable: true,
  reads: [] as Array<{
    readonly path: string;
    readonly resolve: (file: { readonly content: string } | undefined) => void;
    readonly reject: (cause: unknown) => void;
  }>,
}));

vi.mock("./accountGiteaSessions", () => ({
  useGiteaReadable: () => gitea.readable,
  giteaClientFor: () =>
    gitea.readable
      ? {
          readFile: (_owner: string, _repository: string, path: string) =>
            new Promise((resolve, reject) => {
              gitea.reads.push({ path, resolve, reject });
            }),
        }
      : null,
}));

/** What `main` answers: no file, a file with no services, the recipe, or a failed read. */
type Answer = "missing" | "empty" | "recipe" | "fails";

const RECIPE = "services:\n  - hostname: db\n    type: postgresql@16\n";

/** What the hook said, render by render. */
const renders: GroupRecipe[] = [];
const seen = () => renders.at(-1);

function Probe({
  slug = "beviro",
  pending,
  revision,
}: {
  /** The group's Gitea org; `null` while none is known. */
  readonly slug?: string | null;
  readonly pending?: boolean;
  readonly revision?: string | undefined;
}) {
  renders.push(
    useZeropsGroupRecipe({
      giteaOrigin: "https://gitea.example.test",
      slug: slug ?? undefined,
      tier: "mate",
      enabled: true,
      pending,
      revision,
    }),
  );
  return null;
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  gitea.readable = true;
  gitea.reads = [];
  renders.length = 0;
});

function mount(element: ReactElement): ReactTestRenderer {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

/** Answers the oldest read still waiting. */
async function answer(with_: Answer) {
  const read = gitea.reads.shift();
  expect(read?.path).toBe("0 — AI Agent/import.yaml");
  await act(async () => {
    if (with_ === "fails") read?.reject(new Error("Gitea answered 502."));
    else
      read?.resolve(with_ === "missing" ? undefined : { content: with_ === "empty" ? "" : RECIPE });
  });
}

describe("useZeropsGroupRecipe", () => {
  it.each<{ readonly main: Answer; readonly state: GroupRecipe["state"] }>([
    { main: "missing", state: "absent" },
    { main: "empty", state: "absent" },
    { main: "recipe", state: "present" },
    { main: "fails", state: "unreadable" },
  ])("reads a main that answers $main as $state", async ({ main, state }) => {
    mount(<Probe />);
    expect(seen()?.state).toBe("loading");
    await answer(main);
    expect(seen()?.state).toBe(state);
    expect(seen()?.tier === undefined).toBe(state !== "present");
  });

  it("hands over the recipe's tier, ready to import, and its services", async () => {
    mount(<Probe />);
    await answer("recipe");
    expect(seen()?.tier).toMatchObject({ kind: "tier", tier: "mate" });
    expect(seen()?.services).toEqual(["db"]);
  });

  it.each([
    { case: "while the group's org is still being read", pending: true, state: "loading" },
    { case: "once the group is read as having none", pending: false, state: "absent" },
  ] as const)("reads nothing without the group's org: $case", ({ pending, state }) => {
    mount(<Probe pending={pending} slug={null} />);
    expect(seen()?.state).toBe(state);
    expect(gitea.reads).toEqual([]);
  });

  it("waits for a token rather than calling the recipe absent, and reads once one is back", async () => {
    gitea.readable = false;
    const tree = mount(<Probe />);
    expect(seen()?.state).toBe("loading");
    expect(gitea.reads).toEqual([]);
    gitea.readable = true;
    act(() => {
      tree.update(<Probe />);
    });
    await answer("missing");
    expect(seen()?.state).toBe("absent");
  });

  it("tries again keeping what it said until the new answer, busy meanwhile", async () => {
    mount(<Probe />);
    await answer("fails");
    act(() => {
      seen()?.reread();
    });
    expect(seen()).toMatchObject({ state: "unreadable", rereading: true });
    await answer("recipe");
    expect(seen()).toMatchObject({ state: "present", rereading: false });
  });

  it("reads again from nothing once a proposal lands, not when the forge first answers", async () => {
    const tree = mount(<Probe revision={undefined} />);
    await answer("missing");
    act(() => {
      tree.update(<Probe revision="" />);
    });
    expect(seen()?.state).toBe("absent");
    expect(gitea.reads).toEqual([]);
    act(() => {
      tree.update(<Probe revision="13" />);
    });
    expect(seen()?.state).toBe("loading");
    await answer("recipe");
    expect(seen()?.state).toBe("present");
  });
});
