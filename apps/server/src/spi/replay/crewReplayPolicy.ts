/**
 * crewReplayPolicy — the fixed profile and extension a crew fixture replays
 * against (`fixtures/claude/crew-hooks.jsonl`). Test-only and deterministic:
 * the gate keeps a crewmate inside its own copy of the code, and the
 * extension hands back a fixed context per session start. A fixture's hook
 * lines record exactly what these answer, so the replay proves the Claude
 * translation of a profile, not the crew's real gate.
 *
 * @module crewReplayPolicy
 */
import * as Effect from "effect/Effect";

import type { ClaudeReplayPolicy } from "./claudeReplay.ts";

const LANE = "/var/www/.crew/backend";

export const CREW_REPLAY_POLICY: ClaudeReplayPolicy = {
  profile: {
    sessionContext: "You are @backend on the crew. Work only in your own copy of the code.",
    contextWindow: 400_000,
    maxBudgetUsd: 5,
    decideTool: ({ toolName, input }) => {
      const command =
        toolName === "Bash" && typeof input === "object" && input !== null && "command" in input
          ? String(input.command)
          : "";
      return Effect.succeed(
        command.includes("/var/www") && !command.includes(LANE)
          ? { kind: "deny", reason: `Only your own copy of the code: ${LANE}.` }
          : { kind: "allow" },
      );
    },
    tools: [],
  },
  extension: {
    settings: { autoMemoryEnabled: false, disableAllHooks: false },
    onSessionStart: ({ source }) =>
      Effect.succeed(source === "startup" ? "Crew state seq 1: task #1 is yours." : undefined),
    onPostCompact: () => Effect.void,
  },
};
