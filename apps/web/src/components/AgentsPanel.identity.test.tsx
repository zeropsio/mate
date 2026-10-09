import { OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import * as Schema from "effect/Schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { AgentsPanel } from "./AgentsPanel";

vi.mock("~/zerops/useZeropsMates", () => ({ useKnownMate: () => undefined }));

const decodeActivity = Schema.decodeUnknownSync(OrchestrationThreadActivity);

describe("reported helper identity", () => {
  it.each([
    {
      name: "reported model and effort",
      metadata: { model: "gpt-child", effort: "high" },
      words: "GPT-child · High",
    },
    { name: "only a reported model", metadata: { model: "gpt-child" }, words: "GPT-child" },
    { name: "no reported model or effort", metadata: {}, words: null },
  ])("the Helpers panel shows $name without inventing omitted identity", ({ metadata, words }) => {
    const activity = decodeActivity({
      id: "helper-start",
      kind: "task.started",
      tone: "info",
      summary: "Helper began",
      createdAt: "2026-10-08T10:00:00.000Z",
      turnId: null,
      payload: {
        taskId: "reported-helper",
        agentKind: "agent",
        title: "Reported helper",
        ...metadata,
      },
    });
    const model = deriveAgentPanelModel({ agents: foldSubagentActivities([activity]) });
    const markup = renderToStaticMarkup(<AgentsPanel model={model} activities={[activity]} />);
    expect(markup).toContain("Reported helper");
    if (words === null) expect(markup).not.toContain("GPT-child");
    else expect(markup).toContain(words);
    if (!("effort" in metadata)) expect(markup).not.toContain("High");
  });
});
