// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

/** zcp writes this file atomically before switching. A damaged marker fails closed. */
export function mateUpdateBootPending(): boolean {
  const path = process.env.ZCP_MATE_UPDATE_STATE_FILE;
  if (path === undefined) return false;
  let text: string;
  try {
    text = NodeFS.readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  const state: unknown = JSON.parse(text);
  if (
    typeof state !== "object" ||
    state === null ||
    !("phase" in state) ||
    typeof state.phase !== "string"
  )
    throw new Error("Mate update state is unreadable; zcp must recover the last-good version.");
  return state.phase === "switching" || state.phase === "verifying";
}
