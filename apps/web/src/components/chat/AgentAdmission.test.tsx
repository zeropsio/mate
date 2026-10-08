// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import {
  agentAdmission,
  admissionExplainsRefusal,
  resolveZeropsProviderAvailability,
} from "@t3tools/client-runtime/data";
import { AgentAdmissionExplanation } from "./AgentAdmissionExplanation";
import {
  AgentAdmissionComposition,
  useAgentAdmissionPlacement,
} from "../../zerops/AgentAdmissionComposition";
import { ProviderStatusBanner } from "./ProviderStatusBanner";
import { ThreadErrorBanner } from "./ThreadErrorBanner";

const status: ServerProvider = {
  instanceId: ProviderInstanceId.make("claude"),
  driver: ProviderDriverKind.make("claudeAgent"),
  displayName: "Claude",
  installed: true,
  enabled: true,
  version: "1",
  status: "error",
  auth: { status: "unauthenticated" },
  checkedAt: "2026-10-08T00:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
};
const refusal =
  "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.";

const snapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unauthenticated",
      state: "not-authorized",
    },
  ],
} as const;
function readAdmission() {
  return agentAdmission({
    environmentId: "rig",
    instanceId: status.instanceId,
    viewerSubject: "owner",
    snapshot,
    providers: [status],
    mateName: "Rosa",
    availability: resolveZeropsProviderAvailability({
      entries: [{ instanceId: status.instanceId, driverKind: status.driver }],
      agentAuth: {
        state: "known",
        value: snapshot,
        asOf: { ordinal: 1, atMs: 0 },
        coverage: "complete",
        freshness: { kind: "live" },
      },
      viewerSubject: "owner",
    }),
  });
}
function Conversation() {
  const read = readAdmission();
  const placement = useAgentAdmissionPlacement(read.attention, false);
  return (
    <>
      <AgentAdmissionExplanation attention={placement.composer} onAction={() => {}} />
      <ProviderStatusBanner status={read.providerStatus} onDismiss={() => {}} />
      <ThreadErrorBanner
        error={
          admissionExplainsRefusal(read.attention, refusal, status.driver, status.driver)
            ? null
            : refusal
        }
        driver={status.driver}
        mateName="Rosa"
      />
    </>
  );
}
describe("agent admission", () => {
  it("A missing agent sign-in has one actionable explanation", () => {
    const html = renderToStaticMarkup(
      <AgentAdmissionComposition>
        <Conversation />
      </AgentAdmissionComposition>,
    );
    expect((html.match(/role="status"/gu) ?? []).length).toBe(1);
    expect(html).toContain("Rosa needs a Claude sign-in to continue.");
    expect((html.match(/data-zerops-primary-action="Authorize"/gu) ?? []).length).toBe(1);
  });
  it("An active sign-in requirement cannot be dismissed and survives remount", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    try {
      for (let mount = 0; mount < 2; mount++) {
        const root = createRoot(container);
        try {
          await act(async () => {
            root.render(
              <AgentAdmissionComposition>
                <Conversation />
              </AgentAdmissionComposition>,
            );
          });
          expect(container.textContent).toContain("Rosa needs a Claude sign-in to continue.");
          expect(container.querySelectorAll("button")).toHaveLength(1);
          expect(container.querySelector("button")?.textContent).toBe("Sign in");
          expect(container.querySelector('[aria-label^="Dismiss"]')).toBeNull();
        } finally {
          await act(async () => root.unmount());
        }
      }
    } finally {
      container.remove();
    }
  });
});
