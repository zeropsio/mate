/**
 * Where a crewmate's conversation works, as its crew says: a writer in its own copy
 * (`.crew/<handle>`), a reader or the lead in the Mate's tree. The engine's `AgentWorkspace`
 * asks this first (`zerops/engineAdapters.ts`); a conversation that is not a crewmate's works in
 * the server's directory. The crew's wiring provides it; absent, no conversation is a crewmate's.
 *
 * @module zerops/crew/engine/CrewWorkspaceDirectory
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type { ConversationId } from "@t3tools/contracts";

import type { WorkspaceSetup, WorkspaceUnavailable } from "../../../engine/ports.ts";

export class CrewWorkspaceDirectory extends Context.Service<
  CrewWorkspaceDirectory,
  {
    /**
     * A crewmate's conversation's workspace; none for a conversation that is not a crewmate's.
     * A crewmate's whose workspace cannot be told now fails: it never works in the Mate's tree.
     */
    readonly workspaceOf: (
      conversation: ConversationId,
    ) => Effect.Effect<Option.Option<WorkspaceSetup>, WorkspaceUnavailable>;
  }
>()("t3/zerops/crew/engine/CrewWorkspaceDirectory") {}
