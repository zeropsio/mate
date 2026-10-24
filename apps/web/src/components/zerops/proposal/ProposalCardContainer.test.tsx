// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  NOT_READ_VAULT,
  type AddressDomain,
  type HqProjectPeople,
  type PlaceAddresses,
} from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsOperation, ZeropsProposal } from "@t3tools/client-runtime/zerops/model";

import { useAddressesSheet } from "~/zerops/addressesSheet";
import type { ProposalDecision } from "./proposal.logic";

const source = vi.hoisted(() => ({
  person: undefined as HqProjectPeople | undefined,
  addresses: undefined as PlaceAddresses | undefined,
  members: undefined as unknown,
  projects: undefined as unknown,
  placements: undefined as unknown,
  grants: undefined as unknown,
  unread: {
    projects: { complete: false, projects: [] },
    placements: { complete: false },
    grants: {},
  },
  decision: undefined as ProposalDecision | undefined,
  record: vi.fn(async (_next: ProposalDecision) => null),
  run: vi.fn(async (_intent: unknown) => ({ ok: true })),
  askMate: vi.fn(),
  navigate: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => NOT_READ_VAULT }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => source.navigate }));
vi.mock("~/zerops/ZeropsAccountData", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useProjection: (projection: { readonly name: string }) =>
      useSyncExternalStore(
        (listener) => {
          source.listeners.add(listener);
          return () => source.listeners.delete(listener);
        },
        () =>
          projection.name === "addresses"
            ? source.addresses
            : projection.name === "organizationMembers"
              ? source.members
              : projection.name === "organizationProjects"
                ? (source.projects ?? source.unread.projects)
                : projection.name === "inventoryPlacementStatus"
                  ? (source.placements ?? source.unread.placements)
                  : projection.name === "projectsGrants"
                    ? (source.grants ?? source.unread.grants)
                    : source.person,
      ),
    useDetailDemand: () => undefined,
  };
});
vi.mock("~/zerops/accountHq", () => ({
  useAccountHq: () => ({
    hq: { kind: "official", projectId: "hq", address: "https://hq.example" },
  }),
}));
vi.mock("~/zerops/orgChief", () => ({ useOrgChief: () => "readers-chief" }));
vi.mock("~/zerops/useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ orgId: "org", projectId: "source-mate" }),
}));
vi.mock("~/zerops/proposalRecord", () => ({
  useProposalDecision: () => ({ known: true, decision: source.decision, record: source.record }),
}));
vi.mock("~/zerops/useZeropsMates", () => ({
  useKnownMate: () => ({ name: "Skye" }),
  useZeropsMateDirectory: () => new Map(),
}));
vi.mock("~/zerops/useAskMate", () => ({ useAskMate: () => source.askMate }));
vi.mock("~/zerops/useOpenMate", () => ({ useOpenMate: () => vi.fn() }));
vi.mock("../vault/VaultPanelContainer", () => ({ useVaultWriter: () => ({ run: source.run }) }));
import { ProposalCardContainer } from "./ProposalCardContainer";

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  source.person = undefined;
  source.addresses = undefined;
  source.members = undefined;
  source.projects = undefined;
  source.placements = undefined;
  source.grants = undefined;
  source.decision = undefined;
  useAddressesSheet.getState().close();
  source.run.mockClear();
  source.record.mockClear();
  source.askMate.mockClear();
  source.navigate.mockClear();
  vi.unstubAllGlobals();
});
let operation = {
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
  mine: undefined,
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

describe("a Mate can ask its Chief only when one exists", () => {
  it.each([false, true])(
    "with no Chief, the card offers no send and promises no recipient (arrives later: %s)",
    async (later) => {
      if (!later) source.person = person(null, true);
      await draw();
      if (later) await identify(person(null, true));
      expect(document.querySelector("[data-proposal-summary]")?.textContent).toBe(
        "This Mate has no Chief to ask.",
      );
      expect(document.querySelector("[data-proposal-recipient]")).toBeNull();
      expect(decisions().map((button) => button.textContent)).toEqual(["Decline"]);
      const setup = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Set up Chief",
      );
      expect(setup).toBeDefined();
      await act(async () => setup!.click());
      expect(source.navigate).toHaveBeenCalledWith({ to: "/chief" });
      expect(source.askMate).not.toHaveBeenCalled();
      expect(source.record).not.toHaveBeenCalled();
    },
  );
  it("does not claim the reader has no Chief when the source Mate's person has none", async () => {
    source.person = person(null, false);
    await draw();
    expect(document.querySelector("[data-proposal-summary]")?.textContent).toBe(
      "This Mate has no Chief to ask.",
    );
    expect(decisions()).toHaveLength(0);
    expect(source.askMate).not.toHaveBeenCalled();
  });
  it("withholds the promised recipient until HQ identifies a Chief, then withdraws it if none exists", async () => {
    await draw();
    expect(document.querySelector("[data-proposal-summary]")?.textContent).toBe(
      "Finding this Mate's Chief…",
    );
    await identify(person("owners-chief", true));
    expect(document.querySelector("[data-proposal-summary]")?.textContent).toBe(
      "Ask your Chief who owns orders",
    );
    expect(decisions().map((button) => button.textContent)).toEqual(["Approve", "Decline"]);
    await identify(person(null, true));
    expect(document.querySelector("[data-proposal-summary]")?.textContent).toBe(
      "This Mate has no Chief to ask.",
    );
    expect(decisions().map((button) => button.textContent)).toEqual(["Decline"]);
    expect(source.askMate).not.toHaveBeenCalled();
  });
});

const domainProposal: ZeropsProposal = {
  id: "domain-offer",
  kind: "domain.add",
  summary: "Put Contoso - production on contoso.com and www.contoso.com",
  reason: "The shop is ready for its own name.",
  projectId: "pProd",
  projectName: "Contoso - production",
  serviceId: "sMedusa",
  serviceName: "medusa",
  params: { domains: ["contoso.com", "www.contoso.com"], port: 9000 },
};
const domainOffer = { proposal: domainProposal } as ZeropsOperation;

const production = (
  domains: ReadonlyArray<Pick<AddressDomain, "domainName" | "face">>,
  waitingDomains: PlaceAddresses["waitingDomains"] = [],
): PlaceAddresses => ({
  state: "ready",
  domains: domains.map((domain) => ({
    routingId: "r1",
    routingDomains: domains.map((each) => each.domainName),
    targets: [{ serviceId: "sMedusa", serviceName: "medusa", port: 9000, path: "/" }],
    sslEnabled: true,
    url: `https://${domain.domainName}`,
    resolvedIps: [],
    nameServers: ["ns1.registrar.example"],
    ...domain,
  })),
  zerops: [],
  ips: { zoneHasSharedV4: false },
  portsState: "ready",
  ports: [],
  webTargets: [],
  portTargets: [],
  waitingDomains,
  waitingPorts: [],
  readsProject: false,
});

describe("the Chief's proposal to put a project on a domain", () => {
  const press = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (each) => each.textContent === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  const first = operation;
  afterEach(() => {
    operation = first;
  });

  it("approving it adds the domains as the person, onto the service's web port", async () => {
    operation = domainOffer;
    source.addresses = production([]);
    await draw();
    await press("Approve");
    expect(source.run).toHaveBeenCalledWith({
      kind: "add-domain",
      orgId: "org",
      projectId: "pProd",
      domains: ["contoso.com", "www.contoso.com"],
      serviceId: "sMedusa",
      port: 9000,
    });
    expect(source.record.mock.calls.map(([next]) => next.state)).toEqual(["running", "done"]);
  });

  it("declining it adds nothing", async () => {
    operation = domainOffer;
    source.addresses = production([]);
    await draw();
    await press("Decline");
    expect(source.run).not.toHaveBeenCalled();
    expect(source.record).toHaveBeenCalledWith(expect.objectContaining({ state: "declined" }));
  });

  it("offers no Approve until the project's addresses are read", async () => {
    operation = domainOffer;
    source.addresses = { ...production([]), state: "reading" };
    await draw();
    await press("Approve");
    expect(source.run).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Reading the project's addresses…");
  });

  it("offers no Approve for a project whose addresses the person can't see", async () => {
    operation = domainOffer;
    source.addresses = { ...production([]), state: "failed" };
    await draw();
    await press("Approve");
    expect(source.run).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("You can't see Contoso - production's addresses.");
  });

  it("names somebody else's waiting change that approving puts in place too", async () => {
    operation = domainOffer;
    source.addresses = production([], [{ id: "w1", label: "Removing api.contoso.com" }]);
    await draw();
    expect(document.body.textContent).toContain(
      "Approving also puts in place: Removing api.contoso.com.",
    );
  });

  it("an approved domain waits for the person's DNS, and Open addresses opens that project's addresses", async () => {
    operation = domainOffer;
    source.decision = { state: "done", at: "2026-10-14T10:00:00.000Z" };
    source.addresses = production([
      { domainName: "contoso.com", face: "dns" },
      { domainName: "www.contoso.com", face: "dns" },
    ]);
    await draw();
    expect(document.querySelector("[role=status]")?.textContent).toContain(
      "Waiting for your DNS. Add contoso.com's records at your DNS provider.",
    );
    await press("Open addresses");
    expect(useAddressesSheet.getState().target).toEqual({ orgId: "org", projectId: "pProd" });
  });

  it("an approved domain waiting for DNS prints the records to add on its card", async () => {
    operation = domainOffer;
    source.decision = { state: "done", at: "2026-10-14T10:00:00.000Z" };
    source.addresses = {
      ...production([{ domainName: "www.contoso.com", face: "dns" }]),
      ips: { v6: "2001:db8::1", sharedV4: "93.185.106.128", zoneHasSharedV4: false },
    };
    await draw();
    const rows = [
      ...document.querySelector("[data-dns-records] table")!.querySelectorAll("tbody tr"),
    ].map((row) => [...row.querySelectorAll("td")].slice(0, 3).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["A", "www.contoso.com", "93.185.106.128"],
      ["AAAA", "www.contoso.com", "2001:db8::1"],
    ]);
    expect(document.querySelector("[data-dns-records]")?.textContent).toContain(
      "Keep both: the shared IPv4 needs the AAAA.",
    );
  });
});

describe("an access proposal's real card", () => {
  const accessOffer = {
    proposal: {
      id: "access",
      kind: "access.set",
      summary: "Access to Contoso: Dana full access, Greta read only",
      reason: "They start on the shop today.",
      projectId: "pProd",
      projectName: "Contoso",
      params: {
        projects: [
          { id: "pProd", name: "Contoso - production" },
          { id: "pStage", name: "Contoso - stage" },
        ],
        people: [
          { person: "Dana", level: "full" },
          { person: "greta@x.io", level: "read" },
        ],
      },
    } satisfies ZeropsProposal,
  } as unknown as ZeropsOperation;
  const members = (list: ReadonlyArray<{ id: string; name: string; email: string }>) => ({
    fact: { kind: "known" },
    members: list.map(({ id, name, email }) => ({
      id,
      roleCode: "NO_ACCESS",
      canCreateProjects: true,
      user: { id: `u-${id}`, fullName: name, firstName: name.split(" ")[0], email },
    })),
  });
  const press = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (one) => one.textContent === label,
    );
    await act(async () => button!.click());
  };
  const first = operation;
  afterEach(() => {
    operation = first;
  });
  const organization = () => {
    source.projects = {
      complete: true,
      projects: [
        { id: "pProd", name: "Contoso - production" },
        { id: "pStage", name: "Contoso - stage" },
      ],
    };
    source.placements = { complete: true };
  };

  it("approving it gives each person their access as the person, on every project it names", async () => {
    operation = accessOffer;
    organization();
    source.members = members([
      { id: "cu-dana", name: "Dana Developer", email: "dana@x.io" },
      { id: "cu-greta", name: "Greta Guest", email: "greta@x.io" },
    ]);
    await draw();
    await press("Approve");
    expect(source.run).toHaveBeenCalledWith({
      kind: "set-project-access",
      orgId: "org",
      changes: [
        { clientUserId: "cu-dana", projectId: "pProd", roleCode: "ADMIN" },
        { clientUserId: "cu-dana", projectId: "pStage", roleCode: "ADMIN" },
        { clientUserId: "cu-greta", projectId: "pProd", roleCode: "READ_ONLY" },
        { clientUserId: "cu-greta", projectId: "pStage", roleCode: "READ_ONLY" },
      ],
    });
    expect(source.record.mock.calls.map(([next]) => next.state)).toEqual(["running", "done"]);
  });

  it("offers no Approve for a person nobody in the organization is, and says how to invite them", async () => {
    operation = accessOffer;
    source.members = members([{ id: "cu-dana", name: "Dana Developer", email: "dana@x.io" }]);
    organization();
    await draw();
    expect(document.body.textContent).toContain(
      "No one in your organization is greta@x.io. Invite them from Team, then ask again.",
    );
    await press("Approve");
    expect(source.run).not.toHaveBeenCalled();
  });

  it("holds Approve until HQ says who owns these Mates, so nobody's own Mate is written over", async () => {
    operation = accessOffer;
    source.members = members([
      { id: "cu-dana", name: "Dana Developer", email: "dana@x.io" },
      { id: "cu-greta", name: "Greta Guest", email: "greta@x.io" },
    ]);
    organization();
    source.placements = { complete: false };
    await draw();
    expect(document.body.textContent).toContain("Reading who owns these Mates…");
    await press("Approve");
    expect(source.run).not.toHaveBeenCalled();
  });

  it("its card says who gets which level on which project, what changes from today, and what it leaves out", async () => {
    operation = accessOffer;
    source.members = members([
      { id: "cu-dana", name: "Dana Developer", email: "dana@x.io" },
      { id: "cu-greta", name: "Greta Guest", email: "greta@x.io" },
    ]);
    organization();
    source.projects = {
      complete: true,
      projects: [{ id: "pProd", name: "Contoso - production" }],
    };
    source.grants = {
      pProd: { status: "ready", grants: [{ clientUserId: "cu-greta", roleCode: "READ_ONLY" }] },
    };
    await draw();
    const lines = (part: string) =>
      [...document.querySelectorAll(`[data-proposal-${part}] li`)].map((li) => li.textContent);
    expect(lines("access")).toEqual([
      "Dana Developer · Full on Contoso - production · new",
      "Greta Guest · Read on Contoso - production · unchanged",
    ]);
    expect(lines("left-out")).toEqual([
      "Left out: Contoso - stage: not a project in your organization",
    ]);
  });
});
