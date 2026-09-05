import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
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
  it("lists Mates under their project, each with its face, tag and word", () => {
    const html = render([CRM_DEV, CRM_PROD]);
    expect(html).toContain("Beviro CRM");
    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(2);
    expect(html.match(/data-zerops-primitive="mate-face"/gu)).toHaveLength(2);
    expect(html).toContain("crm-dev");
    expect(html).toContain("crm-prod");
    expect(html).toContain("Production");
    // Two Mates, two colours.
    const tints = [...html.matchAll(/data-mate-face-tint="([a-z]+)"/gu)].map((match) => match[1]);
    expect(new Set(tints).size).toBe(2);
  });

  it("folds every environment under the project, Mate or not, and counts them", () => {
    const html = render([CRM_DEV, NO_MATE]);
    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
    expect(html).toContain('data-zerops-surface="sidebar-environments-fold"');
    expect(html).toContain("2 environments");
    // Folded by default: the rows are not in the markup until opened.
    expect(html).not.toContain('data-zerops-surface="sidebar-environment-rows"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("leaves out a project nobody lives in", () => {
    const html = render([
      CRM_DEV,
      candidate("other", ["mate:g:bbb", "mate:role:dev"], "ready", false),
    ]);
    expect(html).toContain('data-zerops-group="aaa"');
    expect(html).not.toContain('data-zerops-group="bbb"');
  });

  it("keeps a Mate whose container is not reachable right now, asleep", () => {
    // Membership is presence, not liveness — a sleeping container must not
    // make a row vanish from under the user.
    const asleep: ZeropsCandidate = {
      ...CRM_DEV,
      group: "unavailable",
      reason: "container is STOPPED",
    };
    const html = render([asleep]);
    expect(html).toContain("crm-dev");
    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).toContain("Unavailable");
  });

  it("shows an ungrouped Mate without inventing a project for it", () => {
    const html = render([LOOSE]);
    expect(html).toContain("loose");
    expect(html).not.toContain("Ungrouped");
  });

  it("labels the ungrouped section only when there is a project to tell it from", () => {
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

  it("marks the active Mate", () => {
    const html = render([CRM_DEV, CRM_PROD], { activeProjectId: "crm-prod" });
    expect(html).toContain('aria-current="true"');
    expect(html.match(/aria-current="true"/gu)).toHaveLength(1);
  });
});

describe("the Mate's row", () => {
  const NAMED = candidate("crm-dev", [
    "mate:g:aaa",
    "mate:role:dev",
    "mate:name:Beviro CRM",
    "mate:bot:Ada",
  ]);
  const working: ZeropsAgentActivity = {
    threadId: "t1" as ZeropsAgentActivity["threadId"],
    kind: "working",
    status: {
      kind: "working",
      toneId: "active",
      label: "Working",
      colorClass: "text-sky-600",
      dotClass: "bg-sky-500",
      pulse: true,
    },
    face: "working",
    subject: "Reviewing the migration",
  };

  it("leads with the agent's name, not the project's", () => {
    const html = render([NAMED]);
    expect(html).toContain("Ada");
    expect(html).not.toContain(">crm-dev<");
  });

  it("wears the conversation's state and says what it is on, when the caller knows", () => {
    const html = render([{ ...NAMED, group: "connected" }], { getActivity: () => working });
    expect(html).toContain('data-mate-face-state="working"');
    expect(html).toContain(">Working<");
    expect(html).toContain("text-sky-600");
    expect(html).toContain("animate-status-pulse");
    expect(html).toContain('data-zerops-surface="sidebar-mate-subject"');
    expect(html).toContain("Reviewing the migration");
  });

  it("calls a connected environment with nothing running idle, with open eyes", () => {
    // The socket is the client's business; the row answers what the agent
    // is up to.
    const html = render([{ ...NAMED, group: "connected" }]);
    expect(html).toContain(">Idle<");
    expect(html).toContain('data-mate-face-state="idle"');
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("sidebar-mate-subject");
  });

  it("is asleep, and says Ready, for a container nobody has connected to", () => {
    const html = render([NAMED]);
    expect(html).toContain(">Ready<");
    expect(html).toContain('data-mate-face-state="sleep"');
  });

  it("says Connecting while a registered environment's socket comes up", () => {
    const connecting: ZeropsCandidate & {
      readonly connection: { phase: "connecting"; error: null; traceId: null };
    } = { ...NAMED, connection: { phase: "connecting", error: null, traceId: null } };
    const html = render([connecting]);
    expect(html).toContain(">Connecting<");
    expect(html).not.toContain(">Ready<");
  });
});
