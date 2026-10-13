// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { NOT_READ_VAULT, type HqProjectPeople } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

const source = vi.hoisted(() => ({
  person: undefined as HqProjectPeople | undefined,
  record: vi.fn(async () => null),
  listeners: new Set<() => void>(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => NOT_READ_VAULT }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/zerops/ZeropsAccountData", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useProjection: () =>
      useSyncExternalStore(
        (listener) => {
          source.listeners.add(listener);
          return () => source.listeners.delete(listener);
        },
        () => source.person,
      ),
    useDetailDemand: () => undefined,
  };
});
vi.mock("~/zerops/ownChief", () => ({ useOwnChief: () => "readers-chief" }));
vi.mock("~/zerops/useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ orgId: "org", projectId: "source-mate" }),
}));
vi.mock("~/zerops/proposalRecord", () => ({
  useProposalDecision: () => ({ known: true, record: source.record }),
}));
vi.mock("~/zerops/useZeropsMates", () => ({
  useKnownMate: () => ({ name: "Skye" }),
  useZeropsMateDirectory: () => new Map(),
}));
vi.mock("~/zerops/useAskMate", () => ({ useAskMate: () => vi.fn() }));
vi.mock("~/zerops/useOpenMate", () => ({ useOpenMate: () => vi.fn() }));
vi.mock("../vault/VaultPanelContainer", () => ({ useVaultWriter: () => ({}) }));
import { ProposalCardContainer } from "./ProposalCardContainer";

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  source.person = undefined;
  source.record.mockClear();
  vi.unstubAllGlobals();
});
const operation = {
  proposal: {
    id: "offer",
    kind: "chief.message",
    projectId: "source-mate",
    summary: "Ask your Chief who owns orders",
    params: { words: "Who owns orders?" },
  },
} as ZeropsOperation;
async function draw() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  if (root === undefined) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <ProposalCardContainer operation={operation} environmentId={"env" as EnvironmentId} />,
    ),
  );
}
const decisions = () =>
  [...document.querySelectorAll("button")].filter((button) =>
    ["Approve", "Decline"].includes(button.textContent ?? ""),
  );
async function identify(next: HqProjectPeople) {
  await act(async () => {
    source.person = next;
    source.listeners.forEach((listener) => listener());
  });
}
const person = (projectId: string | null, mine: boolean): HqProjectPeople => ({
  owned: true,
  owner: null,
  waitsOnViewer: false,
  signedInNow: {},
  everSignedIn: {},
  chief: { projectId, mine },
});
describe("a Chief proposal's real card", () => {
  it("a reader with a Chief cannot decide another person's Chief offer", async () => {
    source.person = person("owners-chief", false);
    await draw();
    expect(decisions()).toHaveLength(0);
    expect(document.body.textContent).toContain("Only this Mate's person can ask their Chief.");
    expect(source.record).not.toHaveBeenCalled();
  });
  it("only offers decisions after HQ identifies the source Mate's person as the viewer", async () => {
    await draw();
    expect(decisions()).toHaveLength(0);
    await identify(person("owners-chief", false));
    expect(decisions()).toHaveLength(0);
    await identify(person("owners-chief", true));
    expect(decisions().map((button) => button.textContent)).toEqual(["Approve", "Decline"]);
    await act(async () => decisions()[1]!.click());
    expect(source.record).toHaveBeenCalledWith(expect.objectContaining({ state: "declined" }));
  });
});
