import { releaseContentsSummary, type EnvironmentRow } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ZeropsGroupPane } from "./ZeropsGroupDetail";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => undefined,
}));

const CHECKING = "Checking your access to this project…";

const environment = (
  projectId: string,
  name: string,
  tier: EnvironmentRow["tier"] = "stage",
): EnvironmentRow =>
  ({
    projectId,
    name,
    tier,
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

function render(
  who: Pick<
    React.ComponentProps<typeof ZeropsGroupPane>,
    "mates" | "matesNotice" | "onMatesNoticeAct"
  > = {
    mates: [
      mate("theo", "Theo", "Cache the link previews"),
      mate("iris", "Iris", "Split the checkout"),
    ],
  },
  stops: Pick<React.ComponentProps<typeof ZeropsGroupPane>, "environments" | "withheldNotice"> = {
    environments: [environment("stage", "stage"), environment("prod", "production")],
  },
) {
  return renderToStaticMarkup(
    <ZeropsGroupPane
      attention={[]}
      commits={{ kind: "no-gitea" }}
      crumbs={[]}
      groupId="shop"
      {...who}
      {...stops}
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
    />,
  );
}

describe("ZeropsGroupPane", () => {
  it("draws every line's content", () => {
    const markup = render();

    expect(markup).toContain("Split the checkout");
    expect(markup).toContain("Cache the link previews");
    expect(markup).toContain("production");
  });

  // DESIGN §3.4, M7: a stop the grant withholds keeps its place in the list and nothing of its
  // project — neither its name, what it runs, nor a way into it.
  it("draws a stop the grant withholds as its tier and why", () => {
    const markup = render(undefined, {
      environments: [
        environment("stage", "Shop stage"),
        environment("prod", "Harbor live", "production"),
      ],
      withheldNotice: (projectId) => (projectId === "prod" ? CHECKING : null),
    });

    expect(markup).toContain("production");
    expect(markup).toContain(CHECKING);
    expect(markup).not.toContain("Harbor live");
    expect(markup.match(/3f9c1b2/g)).toHaveLength(1);
    expect(markup.match(/<button/g)?.length).toBe(render().match(/<button/g)!.length - 1);
  });

  const NO_MATE = "No Mate is working on this project yet.";

  it("never says no Mate is on it while the listing is unread: a placeholder instead", () => {
    const markup = render({
      mates: [],
      matesNotice: {
        region: "placeholder",
        message: { text: "Checking who is on it…", afterMs: 400, tone: "quiet" },
        affordance: null,
      },
    });

    expect(markup).not.toContain(NO_MATE);
    expect(markup).toContain("Checking who is on it…");
    expect(markup).not.toContain("Try again");
  });

  it("names why the listing's read failed once, with one Try again, and no none", () => {
    const markup = render({
      mates: [],
      matesNotice: {
        region: "message",
        message: {
          text: "Couldn't read who is on this project. Zerops didn't answer.",
          afterMs: 0,
          tone: "alert",
        },
        affordance: { kind: "retry", label: "Try again" },
      },
      onMatesNoticeAct: () => {},
    });

    expect(markup).not.toContain(NO_MATE);
    expect(markup.match(/Zerops didn(?:&#x27;|')t answer\./g)).toHaveLength(1);
    expect(markup.match(/Try again/g)).toHaveLength(1);
  });

  it("says no Mate is on it only once the listing is complete", () => {
    expect(render({ mates: [], matesNotice: null })).toContain(NO_MATE);
  });
});
