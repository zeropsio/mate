import { releaseContentsSummary, type EnvironmentRow } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ZeropsGroupPane } from "./ZeropsGroupDetail";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => undefined,
}));

const CHECKING = "Checking your access to this project…";

const environment = (projectId: string, name: string): EnvironmentRow =>
  ({
    projectId,
    name,
    tier: "stage",
    source: "main",
    tone: "good",
    version: {
      name: undefined,
      label: "3f9c1b2",
      commit: "3f9c1b2e",
      sha: "3f9c1b2e".padEnd(40, "0"),
      taggedBy: undefined,
    },
    versionRepository: undefined,
  }) as EnvironmentRow;

const mate = (projectId: string, name: string, subject: string) => ({
  projectId,
  name,
  tint: "amber" as const,
  face: "working" as const,
  subject,
  snippet: undefined,
  when: "1h",
});

function render(withheld: ReadonlySet<string>) {
  return renderToStaticMarkup(
    <ZeropsGroupPane
      attention={[]}
      commits={{ kind: "no-gitea" }}
      crumbs={[]}
      environments={[environment("stage", "stage"), environment("prod", "production")]}
      groupId="shop"
      mates={[
        mate("theo", "Theo", "Cache the link previews"),
        mate("iris", "Iris", "Split the checkout"),
      ]}
      name="Shop"
      names={{ mateNames: new Map(), groupName: "Shop" }}
      onAct={() => {}}
      onAddMate={() => {}}
      onOpenMate={() => {}}
      onSetUp={() => {}}
      pullRequests={[]}
      readDetail={undefined}
      release={{
        offered: false,
        releasing: false,
        tag: undefined,
        contents: [],
        onRelease: () => {},
      }}
      repo={undefined}
      waiting={releaseContentsSummary([], 20)}
      withheldNotice={(projectId) => (withheld.has(projectId) ? CHECKING : null)}
    />,
  );
}

describe("ZeropsGroupPane", () => {
  // A project without fresh access evidence keeps its name and says why its
  // content is not shown (DESIGN G12).
  it("draws a withheld Mate and environment by name with the checking placeholder", () => {
    const markup = render(new Set(["iris", "prod"]));

    expect(markup).toContain("Iris");
    expect(markup).not.toContain("Split the checkout");
    expect(markup).toContain("Cache the link previews");
    expect(markup).toContain("production");
    expect(markup.match(new RegExp(CHECKING, "g"))).toHaveLength(2);
  });

  it("draws every line's content while nothing is withheld", () => {
    const markup = render(new Set());

    expect(markup).toContain("Split the checkout");
    expect(markup).not.toContain(CHECKING);
  });
});
