import { ThreadId } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { expect, it } from "vite-plus/test";
import {
  EMPTY_JUMP_INDEX,
  jumpGroups,
  jumpMateOf,
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
it("MN5: The jump box finds but never offers writing to a Mate somebody else signed in, and offers a new project only where the viewer's role offers one", () => {
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

// witness: apps/web/src/components/zerops/JumpBox.logic.ts | const face = life === "up" ? read : matePose(read, input.pose); → const face = read;
it("MN+10: A Mate's find in the jump box wears the face its menu row wears for its life: one coming up, stopped or on its way off Zerops wears that life's pose over its conversation and a change waiting on its review; breaks: the viewer's Mate being deleted, with its change waiting for review, reads needs-you in the jump box while its menu row sleeps", () => {
  const idle = { threadId: ThreadId.make("thread-nova"), kind: "idle", face: "idle" } as const;
  const working = {
    threadId: ThreadId.make("thread-nova"),
    kind: "working",
    face: "working",
  } as const;
  const rows = [
    { life: "up", activity: idle, face: "needs" },
    { life: "deleting", activity: idle, face: "sleep" },
    { life: "deleting", activity: working, face: "sleep" },
    { life: "coming", activity: idle, face: "waking" },
    { life: "failed", activity: idle, face: "sleep" },
  ] as const;
  for (const row of rows) {
    const found = jumpMateOf({
      projectId: "p-nova",
      name: "Nova",
      tint: "sky",
      shape: MATE_SHAPE_OF_TINT.sky,
      projectName: "Shop",
      environmentId: "env-p-nova",
      owner: { called: "you", isViewer: true },
      connected: true,
      activity: { ...row.activity, subject: undefined, snippet: undefined, pausedUntil: undefined },
      reviewWaits: true,
      mine: true,
      pose: { life: row.life },
    });
    expect({ life: row.life, face: found.face }).toEqual({ life: row.life, face: row.face });
  }
});
