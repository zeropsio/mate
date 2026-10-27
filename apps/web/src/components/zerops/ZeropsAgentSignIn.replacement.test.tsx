// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ZeropsAgentSignInDialog } from "./ZeropsAgentSignIn";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("~/zerops/useZeropsFeeds", () => ({
  useZeropsAgentAuth: () => ({
    state: "known",
    freshness: { kind: "live" },
    value: {
      agents: [{ agentId: "codex", credPresent: true, authorizedBy: { subject: "ann" } }],
      logins: [
        { id: "codex-work", agent: "codex", state: "authorized", token: false, signedInBy: "ann" },
      ],
    },
  }),
}));
vi.mock("~/state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: "connected" } }),
}));
vi.mock("~/zerops/useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ orgId: "org" }),
}));
vi.mock("~/zerops/useUsualAgent", () => ({
  useUsualAgent: () => ({ usual: null, settled: true }),
}));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({ user: { id: "bo" } }),
}));
vi.mock("~/zerops/useZeropsMateOwners", () => ({
  useHqPersonNames: () => (id: string) => (id === "ann" ? "Ann" : undefined),
}));
vi.mock("~/zerops/useAgentLogin", () => ({ useAgentLogin: () => start }));
vi.mock("~/zerops/useAgentLoginCancel", () => ({ useAgentLoginCancel: () => vi.fn() }));
vi.mock("~/zerops/useAgentLoginSubmitCode", () => ({ useAgentLoginSubmitCode: () => vi.fn() }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  start.mockClear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it.each([null, "codex-work"])(
  "A %s sign-in names the recorded member, defaults to Cancel, and starts only after confirmation",
  async (loginId) => {
    const close = vi.fn();
    await act(() =>
      root.render(
        <ZeropsAgentSignInDialog
          environmentId={null}
          threadRef={null}
          agentId="codex"
          mateName="Fen"
          login={
            loginId === null
              ? null
              : { id: loginId, agentId: "codex", title: "work", login: undefined }
          }
          onClose={close}
        />,
      ),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "This replaces Ann's sign-in for this agent on this Mate.",
    );
    expect(start).not.toHaveBeenCalled();
    const cancel = document.querySelector<HTMLButtonElement>("[data-sign-in-replace-cancel]")!;
    expect(document.activeElement).toBe(cancel);
    await act(() => cancel.click());
    expect(close).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    await act(() => document.querySelector<HTMLButtonElement>("[data-sign-in-replace]")!.click());
    expect(start).toHaveBeenCalledExactlyOnceWith("codex", loginId ?? undefined);
  },
);
