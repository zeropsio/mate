// @vitest-environment happy-dom
/**
 * *Start the crew* pressed: what the setup says when the Mate refuses it, and that the press
 * stays there to try again.
 */
import { CrewCommandError, EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { CrewCommand } from "@t3tools/contracts";
import { parseBrief, renderCrewHome } from "@t3tools/shared/crewHome";
import { crewFromProposal } from "@t3tools/shared/crewTemplates";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  crewFailureCauseOf,
  type CrewFailureCause,
  type UseCrewCommand,
} from "~/zerops/crew/useCrewCommand";

import { CrewSetup } from "./CrewSetup";

vi.mock("~/zerops/accountLifetime", async (original) => ({
  ...(await original<typeof import("~/zerops/accountLifetime")>()),
  accountLocalStorage: {
    getItem: () => null,
    setItem: () => true,
    removeItem: () => undefined,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const crew = {
  ...crewFromProposal({
    proposal: {
      lead: { name: "Planner", part: "Plans the Shop Front and splits the work." },
      builders: [{ name: "Orders", part: "Builds the orders page." }],
    },
    crew: "crew",
    devHosts: ["appdev"],
  }),
  brief: parseBrief("Shop Front", "A shop front for Acme's teas.\n"),
};

const REFUSAL = new CrewCommandError({
  reason: "database-undeclared",
  detail:
    "crew.yaml: orders works on appdev, which reaches a database: give it its own env: or say database: shared.",
});

/** The setup over `crew`, whose Mate refuses the first Start as `REFUSAL`; every command sent. */
function setUp(): Array<CrewCommand> {
  const sent: Array<CrewCommand> = [];
  let failure: CrewFailureCause | null = null;
  const commands: UseCrewCommand = {
    files: {
      state: "known",
      value: { files: renderCrewHome(crew) },
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "settled" },
    },
    send: async (command) => {
      sent.push(command);
      failure = sent.length === 1 ? crewFailureCauseOf(REFUSAL) : null;
      return failure === null ? { _tag: "done" } : null;
    },
    readFiles: async () => null,
    writeFiles: async () => true,
    pending: false,
    isPending: () => false,
    error: null,
    errorAt: () => null,
    lastFailure: () => failure,
    clearError: () => undefined,
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <CrewSetup
        applied={false}
        commands={commands}
        crewmates={[]}
        devHosts={[{ host: "appdev", database: null }]}
        environmentId={EnvironmentId.make("environment-acme")}
        hosts={[]}
        mate={{ name: "Nova", tint: "amber" }}
        onAskPorts={() => undefined}
        onClose={() => undefined}
        onEditCrewmate={() => undefined}
        proposeWith={{
          kind: "ready",
          modelSelection: {
            instanceId: ProviderInstanceId.make("claude"),
            model: "claude-sonnet-4-5",
          },
        }}
      />,
    ),
  );
  return sent;
}

const startPress = () => {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Start the crew",
  );
  if (button === undefined) throw new Error("no Start the crew press");
  return button;
};
const foot = () => document.querySelector(".crew-view-foot")?.textContent ?? "";

describe("CrewSetup's Start", () => {
  it("a refused start says why beside Start and lets it be pressed again", async () => {
    const sent = setUp();

    await act(async () => startPress().click());
    expect(sent).toEqual([{ _tag: "apply" }]);
    expect(foot()).toContain(
      "The crew didn't start: a builder works on a service with a database and doesn't say whether it shares it.",
    );
    expect(document.querySelector("[role=alert]")?.textContent).toContain("didn't start");
    expect(startPress().disabled).toBe(false);

    await act(async () => startPress().click());
    expect(sent).toEqual([{ _tag: "apply" }, { _tag: "apply" }]);
    expect(foot()).not.toContain("didn't start");
  });
});
