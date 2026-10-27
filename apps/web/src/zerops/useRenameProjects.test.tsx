/**
 * Project renames by planned targets: each is sent with the name it was planned from, so a
 * project renamed since is refused; and with no organization open the answer is a rejection the
 * caller's dialog can say, never a throw that leaves it pending.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useRenameProjects, type RenameProjects } from "./useRenameProjects";

const mock = vi.hoisted(() => ({
  organization: { id: "org-1" } as { id: string } | null,
  submit: vi.fn(),
}));

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ activeOrganization: mock.organization }),
}));
vi.mock("./accountOperations", () => ({ useAccountOperations: () => ({ submit: mock.submit }) }));

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  mock.organization = { id: "org-1" };
  mock.submit.mockReset();
});

function hook(): RenameProjects {
  let latest: RenameProjects | undefined;
  function Probe() {
    latest = useRenameProjects();
    return null;
  }
  act(() => {
    mounted.push(create(createElement(Probe)));
  });
  return latest!;
}

const RENAME = { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" };

describe("useRenameProjects", () => {
  it("sends each rename with the name it was planned from", async () => {
    mock.submit.mockResolvedValue({
      requestId: "r1",
      evidence: null,
      progress: { stage: "done", operationId: "p1", outcome: "succeeded" },
    });
    expect(await hook()([RENAME])).toEqual([]);
    expect(mock.submit).toHaveBeenCalledWith({
      kind: "rename-project",
      orgId: "org-1",
      projectId: "p1",
      name: "Shop - Rune",
      from: "SPN - Rune",
    });
  });

  it("rejects, never throws, where no organization is open", async () => {
    mock.organization = null;
    const rename = hook();
    let answer: Promise<unknown> | undefined;
    expect(() => {
      answer = rename([RENAME]);
    }).not.toThrow();
    await expect(answer).rejects.toThrow("No organization is open.");
  });
});
