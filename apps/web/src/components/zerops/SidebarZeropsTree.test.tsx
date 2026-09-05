import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AgentActivity, SidebarZeropsTree } from "./SidebarZeropsTree";

function candidate(
  id: string,
  tagList: ReadonlyArray<string>,
  group: ZeropsCandidate["group"] = "ready",
  withMate = true,
): ZeropsCandidate {
  const base = {
    key: `${id}:zcp`,
    project: { id, name: id, status: "ACTIVE", tagList },
    group,
  };
  return withMate
    ? { ...base, service: { id: "zcp", name: "zcp", status: "ACTIVE" } }
    : { ...base, group: "unavailable", reason: "no Zerops Mate container in this project" };
}

const CRM_DEV = candidate("crm-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:Beviro CRM"]);
const CRM_PROD = candidate(
  "crm-prod",
  ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"],
  "connected",
);
const NO_MATE = candidate("bare", ["mate:g:aaa", "mate:role:stage"], "ready", false);
const LOOSE = candidate("loose", []);

function render(candidates: ReadonlyArray<ZeropsCandidate>, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <SidebarZeropsTree
      candidates={candidates}
      onBrowseProjects={() => {}}
      onSelect={() => {}}
      {...props}
    />,
  );
}

describe("SidebarZeropsTree", () => {
  it("lists environments under their group", () => {
    const html = render([CRM_DEV, CRM_PROD]);
    expect(html).toContain("Beviro CRM");
    expect(html).toContain("crm-dev");
    expect(html).toContain("crm-prod");
    expect(html).toContain("Production");
  });

  it("leaves out a project that has no Mate, however it is tagged", () => {
    const html = render([CRM_DEV, NO_MATE]);
    expect(html).toContain("crm-dev");
    expect(html).not.toContain("bare");
  });

  it("keeps an environment whose container is not reachable right now", () => {
    // Membership is presence, not liveness — a sleeping container must not
    // make a row vanish from under the user.
    const asleep: ZeropsCandidate = {
      ...CRM_DEV,
      group: "unavailable",
      reason: "container is STOPPED",
    };
    expect(render([asleep])).toContain("crm-dev");
  });

  it("shows an ungrouped environment without inventing a group for it", () => {
    const html = render([LOOSE]);
    expect(html).toContain("loose");
    expect(html).not.toContain("Ungrouped");
  });

  it("labels the ungrouped section only when there is a group to tell it from", () => {
    expect(render([CRM_DEV, LOOSE])).toContain("Ungrouped");
  });

  it("says Mate is missing, not that projects are, when the account has projects", () => {
    const html = render([NO_MATE]);
    expect(html).toContain("No environment has Mate yet");
    expect(html).toContain("Set up Mate");
    expect(html).not.toContain("No Zerops projects yet");
  });

  it("says there are no projects only when there are none", () => {
    const html = render([]);
    expect(html).toContain("No Zerops projects yet");
    expect(html).toContain("New project");
  });

  it("marks the active environment", () => {
    const html = render([CRM_DEV, CRM_PROD], { activeProjectId: "crm-prod" });
    expect(html).toContain('aria-current="true"');
    expect(html.match(/aria-current="true"/gu)).toHaveLength(1);
  });
});

describe("the agent's name", () => {
  const NAMED = candidate("crm-dev", [
    "mate:g:aaa",
    "mate:role:dev",
    "mate:name:Beviro CRM",
    "mate:bot:Ada",
  ]);

  it("leads with the agent's name, not the project's", () => {
    const html = render([NAMED]);
    expect(html).toContain("Ada");
    expect(html).not.toContain("crm-dev");
  });

  it("falls back to the project name when no agent is named", () => {
    expect(render([CRM_DEV])).toContain("crm-dev");
  });

  it("shows what it is doing when the caller knows", () => {
    const html = render([NAMED], {
      renderActivity: () => <span>reviewing the migration</span>,
    });
    expect(html).toContain("reviewing the migration");
    // The injected line replaces the bucket, rather than sitting beside it.
    expect(html).not.toContain("READY");
  });

  it("falls back to where it stands when nobody knows", () => {
    expect(render([NAMED])).toContain("Ready");
  });
});

describe("AgentActivity", () => {
  it("renders the thread status pill's words and tone, and pulses only when told to", () => {
    const html = renderToStaticMarkup(
      <AgentActivity
        status={{
          label: "Working",
          colorClass: "text-sky-600",
          dotClass: "bg-sky-500",
          pulse: true,
        }}
      />,
    );
    expect(html).toContain("Working");
    expect(html).toContain("text-sky-600");
    expect(html).toContain("bg-sky-500");
    expect(html).toContain("animate-status-pulse");

    const still = renderToStaticMarkup(
      <AgentActivity status={{ label: "Done", colorClass: "c", dotClass: "d", pulse: false }} />,
    );
    expect(still).not.toContain("animate-status-pulse");
  });
});
