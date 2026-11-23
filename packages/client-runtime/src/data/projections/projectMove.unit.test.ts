import { expect, it } from "vite-plus/test";
import type { HqOperation } from "../../zerops/hq/client.ts";
import { projectMoveOf } from "./projectMove.ts";

const acceptedAt = "2026-11-22T10:00:00.000Z";
const at = "2026-11-22T10:00:05.000Z";
const move = (rest: Partial<HqOperation>) => ({
  hq: {
    operation: {
      id: "op-move",
      kind: "project_move",
      phase: "rename_requested",
      at,
      acceptedAt,
      ...rest,
    },
  },
});
const failure = (code: string, origin: string) => ({ step: "rename_project", code, at, origin });

// witness: packages/client-runtime/src/data/projections/projectMove.ts | return move.kind === "failed" && move.failure.code === RENAMED_SINCE → return move.kind === "failed" && move.failure.code === "never"
it("PJ132: A move that ended because Zerops shows a name someone gave the project since reads as placed under that name, never as a failure, while any other failure reads with HQ's failure as sent, and a move waiting for its maker offers Continue to them alone; breaks: a person whose colleague renamed the project is shown a red failure for a move that landed", () => {
  expect(projectMoveOf(move({ failure: failure("renamed_since", "hq") }))).toEqual({
    kind: "renamed-since",
  });
  const refused = { ...failure("projectNameDuplicate", "zerops"), zerops: { words: null } };
  expect(projectMoveOf(move({ failure: refused }))).toEqual({
    kind: "failed",
    failure: refused,
  });
  expect(projectMoveOf(move({}))).toEqual({ kind: "going" });
  expect(
    projectMoveOf(move({ failure: failure("token_expired", "hq"), continueBy: "eva" })),
  ).toEqual({ kind: "waiting", id: "op-move", continueBy: "eva", yours: false });
  expect(projectMoveOf(move({ kind: "mate_deletion" }))).toEqual({ kind: "none" });
});
