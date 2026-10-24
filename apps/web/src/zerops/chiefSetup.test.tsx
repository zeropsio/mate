// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { CreationRead, RunToEnd } from "@t3tools/client-runtime/data";

const source = vi.hoisted(() => ({
  run: vi.fn(),
  begin: vi.fn(),
  finish: vi.fn(),
  navigate: vi.fn(),
}));
let completed: Promise<void>;
const hq = { projectId: "hq", address: "https://hq.example" };
const accountHq = { hq: { kind: "official", ...hq }, status: "ready" };
const operations = { run: source.run, readCreation: () => UNSENT };
vi.mock("./accountOperations", () => ({
  HQ_UNFOLLOWED: "HQ isn't answering.",
  useAccountOperations: () => operations,
  useAccountOperationsOptional: () => operations,
}));
vi.mock("./accountHq", () => ({
  useAccountHq: () => accountHq,
  officialHq: () => hq,
  useCarriedCoreBuild: () => undefined,
}));
vi.mock("./accountInvalidations", () => ({ invalidateZerops: vi.fn() }));
vi.mock("./zeropsDataContext", () => ({ useZeropsData: () => ({ organizationRef: () => null }) }));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    client: {},
    activeOrganization: { id: "org" },
    user: { firstName: "Alex" },
  }),
  useZeropsSessionOptional: () => null,
}));
vi.mock("./accountData", () => ({
  useProjection: () => null,
  useDetailDemand: () => undefined,
  useProjectServices: () => ({ services: [] }),
}));
vi.mock("./ZeropsAccountData", () => ({
  useDetailDemand: () => undefined,
  useProjection: () => ({
    owned: true,
    owner: null,
    waitsOnViewer: false,
    signedInNow: {},
    everSignedIn: {},
    chief: { projectId: null, mine: true },
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => source.navigate }));
vi.mock("./useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ orgId: "org", projectId: "mate" }),
}));
vi.mock("./proposalRecord", () => ({
  useProposalDecision: () => ({ known: true, record: vi.fn() }),
}));
vi.mock("./useZeropsMates", () => ({
  useKnownMate: () => ({ name: "Skye" }),
  useZeropsMateDirectory: () => new Map(),
}));
vi.mock("./useAskMate", () => ({ useAskMate: () => vi.fn() }));
vi.mock("./useOpenMate", () => ({ useOpenMate: () => vi.fn() }));
vi.mock("./orgChief", () => ({ useOrgChief: () => null }));
vi.mock("./useHqOffers", () => ({ useOrgOffers: () => () => ({ kind: "allowed" }) }));
vi.mock("./usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({ membershipKnown: true, manageOrganization: true }),
  useRoleOffers: () => ({ newProject: true, setUpChief: true }),
}));
vi.mock("./creations", async (original) => ({
  ...(await original<typeof import("./creations")>()),
  useCreation: () => undefined,
  runOnce: (_id: string, run: () => Promise<void>) => {
    completed = run();
  },
}));
vi.mock("./matePress", () => ({
  PRESS_MAY_HAVE_LANDED: "Check the original project.",
  useMatePresses: () => [],
  beginPress: source.begin,
  finishMateSetup: source.finish,
  whilePressing: <T,>(run: () => Promise<T>) => run(),
}));
vi.mock("../components/zerops/SidebarZeropsTree", () => ({ MenuMateLine: () => null }));
vi.mock("../components/zerops/ZeropsMateComingPage", () => ({
  MateComingFrame: ({ children }: { children: ReactNode }) => <>{children}</>,
  MateComingHeader: () => null,
  ZeropsMateComingPage: () => null,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ({ kind: "unchecked" }) }));

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { useChiefSetupRunner } from "./chiefSetup";
import { ChiefPage } from "../components/zerops/chief/ChiefPage";
import { ProposalCardContainer } from "../components/zerops/proposal/ProposalCardContainer";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { EnvironmentId } from "@t3tools/contracts";
import { Menu } from "../components/ui/menu";
import { SidebarZeropsAccountMenu } from "../components/zerops/SidebarZeropsAccount";

const NOT_SENT = { state: "not-sent", attempt: 0 } as const;
const UNSENT: CreationRead = {
  steps: { app: NOT_SENT, birth: NOT_SENT, project: NOT_SENT },
  appId: null,
  birthId: null,
  projectId: null,
};
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  await closeAccountLifetime();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("every Chief creation entry uses the same setup intent", () => {
  it.each(["/chief", "account menu", "proposal setup"] as const)(
    "%s creates a project tagged mate and chief",
    async (entry) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      openAccountLifetime("alex");
      source.run.mockImplementation(async (intent: Parameters<RunToEnd>[0]) => {
        switch (intent.kind) {
          case "create-app":
            return { appId: "app" };
          case "record-birth":
            return { birthId: "birth" };
          case "create-project":
            return { projectId: "chief-project" };
          default:
            throw new Error(`Unexpected creation write: ${intent.kind}`);
        }
      });
      function Entry() {
        useChiefSetupRunner();
        const [page, openPage] = useState(entry === "/chief");
        source.navigate.mockImplementation(() => openPage(true));
        if (page) return <ChiefPage />;
        if (entry === "proposal setup")
          return (
            <ProposalCardContainer
              operation={
                {
                  proposal: {
                    id: "offer",
                    kind: "chief.message",
                    projectId: "mate",
                    summary: "Ask your Chief",
                    params: { words: "Who owns orders?" },
                  },
                } as ZeropsOperation
              }
              environmentId={"env" as EnvironmentId}
            />
          );
        return (
          <Menu>
            <SidebarZeropsAccountMenu
              account={{
                name: "Alex",
                fullName: null,
                initials: "A",
                email: null,
                avatarUrl: null,
              }}
              activeOrganization={null}
              chief={{ icon: null, onSetUp: () => openPage(true) }}
              destination={null}
              destinationIcon={() => null}
              onGo={() => {}}
              onSelectOrganization={() => {}}
              onSignOut={() => {}}
              organizations={[]}
            />
          </Menu>
        );
      }
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      await act(async () => root!.render(<Entry />));
      if (entry !== "/chief") {
        const door = container.querySelector<HTMLElement>(
          entry === "account menu" ? "[data-zerops-account-chief]" : "button",
        );
        expect(door?.getAttribute("aria-label") ?? door?.textContent).toContain("Chief");
        await act(async () => door!.click());
      }
      const setup = container.querySelector<HTMLButtonElement>(
        "[data-zerops-surface=chief-set-up]",
      );
      expect(setup?.textContent).toBe("Set up Chief");
      await act(async () => {
        setup!.click();
        await completed;
      });
      expect(source.run).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "create-project",
          orgId: "org",
          name: "Chief · Alex - Chief",
          tagList: ["mate", "chief"],
        }),
        expect.anything(),
      );
      expect(source.finish).toHaveBeenCalledWith(
        expect.objectContaining({ container: { agents: [] } }),
      );
      expect(source.begin).toHaveBeenCalledWith(expect.objectContaining({ placement: null }));
    },
  );
});

it("the Chief page says, before its mark is set, that everyone with access to the Chief's project sees its overview", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openAccountLifetime("alex");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ChiefPage />));
  const offer = container.querySelector("[data-zerops-surface=chief-set-up]")?.parentElement;
  expect(offer?.textContent).toContain(
    "Everyone with access to the Chief's project sees its overview of your organization",
  );
});
