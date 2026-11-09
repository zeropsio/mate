// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { VaultView } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import type { ProposalDecision } from "./proposal.logic";

/** An example value, never a real one. */
const VALUE = ["Hk7q", "2mVz", "example"].join("-");

const VAULT: VaultView = {
  status: "ready",
  complete: true,
  notLive: [],
  scopes: [
    {
      ref: { kind: "service", serviceId: "s-db" },
      id: "s-db",
      hostname: "db",
      kind: "managed",
      serviceType: "postgresql@17",
      editable: false,
      reads: [],
      startedAt: null,
      values: [
        {
          id: "v-pass",
          key: "DATABASE_PASSWORD",
          sensitive: true,
          value: null,
          createdAt: null,
          changedAt: null,
          madeByZerops: true,
          readers: [],
        },
      ],
    } as VaultView["scopes"][number],
  ],
};

const source = vi.hoisted(() => ({
  operates: true as boolean | undefined,
  members: undefined as unknown,
  grants: undefined as unknown,
  decision: undefined as ProposalDecision | undefined,
  record: vi.fn(async (_next: ProposalDecision) => null as string | null),
  reveal: vi.fn(
    async (_scope: unknown, _id: string) =>
      ({ ok: true, value: "" }) as
        | { readonly ok: true; readonly value: string }
        | { readonly ok: false; readonly code: string | null },
  ),
  recorded: vi.fn(async (_intent: unknown) => ({})),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => VAULT }));
vi.mock("~/zerops/ZeropsAccountData", () => ({
  useProjection: (projection: { readonly name: string }) =>
    projection.name === "organizationMembers"
      ? (source.members ?? { members: [] })
      : projection.name === "projectsGrants"
        ? (source.grants ?? {})
        : projection.name === "projectOperator"
          ? source.operates
          : undefined,
  useDetailDemand: () => undefined,
  useAccountDataOptional: () => ({ reveal: { reveal: source.reveal } }),
}));
vi.mock("~/zerops/accountOperations", () => ({
  HQ_UNFOLLOWED: "HQ isn't answering.",
  useAccountOperationsOptional: () => ({ run: source.recorded }),
}));
vi.mock("~/zerops/useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ orgId: "org", projectId: "p-mate" }),
}));
vi.mock("~/zerops/proposalRecord", () => ({
  useProposalDecision: () => ({
    known: true,
    unreachable: false,
    decision: source.decision,
    record: source.record,
  }),
}));
vi.mock("~/zerops/useZeropsMates", () => ({ useKnownMate: () => ({ name: "Juno" }) }));
vi.mock("~/zerops/environmentTier", () => ({ useEnvironmentTier: () => "production" }));
vi.mock("~/zerops/useZeropsMateOwners", () => ({
  usePersonNames: () => (id: string) => (id === "u-ales" ? "Aleš" : undefined),
}));
vi.mock("~/zerops/sessionContext", () => ({
  useZeropsSessionOptional: () => ({
    user: { id: "u-ales" },
    client: { baseUrl: "https://api.zerops.example" },
    sudoBearer: "",
  }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (pick: (settings: { timestampFormat: string }) => unknown) =>
    pick({ timestampFormat: "24-hour" }),
}));
import { ProposalCardContainer } from "./ProposalCardContainer";

const operation = {
  proposal: {
    id: "reveal-1",
    kind: "env.reveal",
    summary: "Show DATABASE_PASSWORD from Production",
    reason: "You asked for it to connect from your laptop.",
    projectId: "p-prod",
    projectName: "Production",
    serviceId: "s-db",
    serviceName: "db",
    params: { scope: "service", key: "DATABASE_PASSWORD" },
  },
} as ZeropsOperation;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  source.operates = true;
  source.members = undefined;
  source.grants = undefined;
  source.decision = undefined;
  source.record.mockClear();
  source.reveal.mockReset();
  source.recorded.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

const button = (label: string) =>
  [...document.querySelectorAll("button")].find((each) => each.textContent === label);
const card = () => document.querySelector("[data-ask-kind='reveal']")?.textContent ?? "";

async function press(label: string) {
  await act(async () => button(label)!.click());
  // The reveal, then HQ's record, each answer in a task of its own.
  for (let turn = 0; turn < 4; turn += 1) await act(async () => {});
}

describe("revealing a hidden value on the card", () => {
  it("shows a production value on the card only once HQ recorded who revealed which key, read with the person's own access", async () => {
    source.reveal.mockResolvedValue({ ok: true, value: VALUE });
    source.record.mockImplementation(async (next) => {
      source.decision = next;
      return null;
    });
    await draw();
    expect(card()).toContain("Show DATABASE_PASSWORD from Production");
    expect(card()).not.toContain(VALUE);
    await press("Reveal production value");
    expect(source.reveal).toHaveBeenCalledWith({ kind: "service", serviceId: "s-db" }, "v-pass");
    expect(source.recorded).toHaveBeenCalledWith(
      {
        kind: "record-reveal",
        orgId: "org",
        reveal: { projectId: "p-prod", service: "db", key: "DATABASE_PASSWORD" },
      },
      expect.anything(),
    );
    expect(source.record).toHaveBeenCalledWith(
      expect.objectContaining({ state: "running", by: "u-ales" }),
    );
    expect(card()).toContain(VALUE);
    expect(card()).toContain("Only on your screen · recorded at HQ");
  });

  it("keeps a value HQ did not record hidden, and says so", async () => {
    source.reveal.mockResolvedValue({ ok: true, value: VALUE });
    source.recorded.mockRejectedValue(new Error("HQ isn't answering."));
    await draw();
    await press("Reveal production value");
    expect(card()).not.toContain(VALUE);
    expect(card()).toContain("HQ couldn't record the reveal, so it stays hidden. Try again.");
    expect(button("Try again")).toBeDefined();
    expect(source.record).not.toHaveBeenCalled();
  });

  it("hides the value after thirty seconds and as the person leaves the window, then says to whom it was revealed and when", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    source.reveal.mockResolvedValue({ ok: true, value: VALUE });
    source.record.mockImplementation(async (next) => {
      source.decision = { ...next, at: "2026-11-04T15:32:00.000Z" };
      return null;
    });
    await draw();
    await press("Reveal production value");
    expect(card()).toContain(VALUE);
    await act(async () => vi.advanceTimersByTime(31_000));
    expect(card()).not.toContain(VALUE);
    expect(card()).toMatch(/Revealed to Aleš at .+ · hidden again/u);

    await press("Reveal again");
    expect(card()).toContain(VALUE);
    // The window loses focus: the page no longer has it.
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(card()).not.toContain(VALUE);
    // Each reveal is recorded at HQ; the decision only once.
    expect(source.recorded).toHaveBeenCalledTimes(2);
    expect(source.record).toHaveBeenCalledTimes(1);
  });

  it("asks the person to confirm it's them where Zerops wants that before it shows a secret", async () => {
    source.reveal.mockResolvedValue({ ok: false, code: "notInSudoMode" });
    await draw();
    await press("Reveal production value");
    expect(card()).toContain("Confirm on your signed-in device to reveal.");
    expect(button("Confirm in Zerops")).toBeDefined();
    expect(source.recorded).not.toHaveBeenCalled();
  });

  it("turns a refusal for the person's role into who can reveal it, with no Try again", async () => {
    source.reveal.mockResolvedValue({ ok: false, code: "notAuthorized" });
    source.members = {
      members: [{ id: "cu-petr", roleCode: "BASIC_USER", user: { id: "petr", fullName: "Petr" } }],
    };
    source.grants = { "p-prod": { status: "ready", grants: [] } };
    await draw();
    await press("Reveal production value");
    expect(card()).toContain("Only people with production access can reveal this. Petr can.");
    expect(button("Try again")).toBeUndefined();
    expect(source.recorded).not.toHaveBeenCalled();
  });

  it("names who can reveal it to someone without production access, and offers no press", async () => {
    source.operates = false;
    source.members = {
      members: [
        { id: "cu-petr", roleCode: "BASIC_USER", user: { id: "petr", fullName: "Petr" } },
        { id: "cu-ales", roleCode: "READ_ONLY", user: { id: "u-ales", fullName: "Aleš" } },
      ],
    };
    source.grants = { "p-prod": { status: "ready", grants: [] } };
    await draw();
    expect(card()).toContain("Only people with production access can reveal this. Petr can.");
    expect(button("Reveal production value")).toBeUndefined();
  });

  it("waits to offer reveal until the person's project access is known", async () => {
    source.operates = undefined;
    await draw();
    expect(button("Reveal production value")?.disabled).toBe(true);
    expect(card()).toContain("Reading your project access…");
  });
});
