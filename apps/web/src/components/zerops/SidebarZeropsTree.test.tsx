import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarZeropsTree } from "./SidebarZeropsTree";

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
