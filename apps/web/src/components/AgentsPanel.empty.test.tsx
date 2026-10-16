import { EnvironmentId } from "@t3tools/contracts";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";

import { AgentsPanel } from "./AgentsPanel";

vi.mock("~/zerops/useZeropsMates", () => ({
  useKnownMate: () => ({ name: "Nova", shape: "round", tint: "coral" }),
}));

it("before any helper, Helpers says the Mate starts them by its name", () => {
  const html = renderToStaticMarkup(
    <AgentsPanel
      environmentId={EnvironmentId.make("environment-nova")}
      model={deriveAgentPanelModel({ agents: foldSubagentActivities([]) })}
    />,
  );
  expect(html).toContain("When Nova starts helpers");
  expect(html).not.toContain("the Mate");
});
