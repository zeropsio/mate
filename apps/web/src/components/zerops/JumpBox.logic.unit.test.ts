import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { expect, it } from "vite-plus/test";
import {
  EMPTY_JUMP_INDEX,
  jumpGroups,
  jumpWritePlan,
  type JumpMate,
  type SidebarJumpIndex,
} from "./JumpBox.logic.ts";

function mate(projectId: string, name: string, owner: JumpMate["owner"], mine: boolean): JumpMate {
  return {
    projectId,
    name,
    tint: "sky",
    shape: MATE_SHAPE_OF_TINT.sky,
    face: "idle",
    projectName: "Shop",
    subject: undefined,
    snippet: undefined,
    environmentId: `env-${projectId}`,
    connected: true,
    conversation: { threadId: `thread-${projectId}`, kind: "idle" },
    owner,
    pausedUntil: undefined,
    mine,
  };
}

const nova = mate("p-nova", "Nova", { called: "you", isViewer: true }, true);
const noel = mate("p-noel", "Noel", { called: "Ada", isViewer: false }, false);
const index: SidebarJumpIndex = {
  ...EMPTY_JUMP_INDEX,
  mates: [nova, noel],
  projects: [{ groupId: "g-shop", name: "Shop", mates: 2 }],
};
const othersSignedIn = new Set([noel.projectId]);

const itemsOf = (groups: ReturnType<typeof jumpGroups>) =>
  groups.flatMap((group) => group.items.map((item) => item.value));

// witness: apps/web/src/components/zerops/JumpBox.logic.ts | (mate) => !readOnly.has(mate.projectId) && contains(mate.name, query.name), → (mate) => contains(mate.name, query.name),
it("MN+3: The jump box finds but never offers writing to a Mate somebody else signed in, and offers a new project only where the viewer's role offers one", () => {
  expect(itemsOf(jumpGroups(index, "No", [], othersSignedIn))).toContain("mate:p-noel");
  const writable = itemsOf(jumpGroups(index, "@No", [], othersSignedIn));
  expect(writable).toContain("write:p-nova");
  expect(writable).not.toContain("write:p-noel");
  expect(
    jumpWritePlan({
      name: noel.name,
      owner: noel.owner,
      conversation: { threadId: "thread-p-noel", kind: "idle" },
      pausedUntilLabel: undefined,
      started: true,
      readOnly: true,
      decision: undefined,
    }).action,
  ).toBe("none");

  expect(itemsOf(jumpGroups(index, "", [], othersSignedIn, true))).toContain("new-project");
  expect(itemsOf(jumpGroups(index, "", [], othersSignedIn, false))).not.toContain("new-project");
  expect(itemsOf(jumpGroups(index, "new", [], othersSignedIn, false))).not.toContain("new-project");
});
