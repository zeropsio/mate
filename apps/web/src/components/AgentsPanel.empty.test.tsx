import { EnvironmentId } from "@t3tools/contracts";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { AgentsPanel } from "./AgentsPanel";

beforeEach(async () => {
  const mates = await import("~/zerops/useZeropsMates");
  vi.spyOn(mates, "useKnownMate").mockReturnValue({
    name: "Nova",
    shape: "squircle",
    tint: "coral",
  } as ReturnType<typeof mates.useKnownMate>);
});
afterEach(() => vi.restoreAllMocks());

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
