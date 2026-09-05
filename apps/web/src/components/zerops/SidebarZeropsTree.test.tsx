import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";
import { SidebarZeropsTree } from "./SidebarZeropsTree";

function candidate(
  id: string,
  tagList: ReadonlyArray<string>,
  group: ZeropsCandidate["group"] = "ready",
  withContainer = true,
): ZeropsCandidate {
  const base = {
    key: `${id}:zcp`,
    project: { id, name: id, status: "ACTIVE", tagList },
    group,
  };
  return withContainer
    ? { ...base, service: { id: "zcp", name: "zcp", status: "ACTIVE" } }
    : {
        ...base,
        group: "unavailable",
        reason: "no Zerops Mate container in this project",
        missingContainer: true,
      };
}

const CRM_DEV = candidate("crm-dev", [
  "mate",
  "mate:g:aaa",
  "mate:role:dev",
  "mate:name:Beviro CRM",
]);
const CRM_STAGE = candidate("crm-stage", ["mate:g:aaa", "mate:role:stage"], "ready", false);
const CRM_PROD = candidate(
  "crm-prod",
  ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"],
  "ready",
  false,
);
const LOOSE = candidate("loose", ["mate"]);

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
  it("names the project as a name, then its Mate as a card with its face and word", () => {
    const html = render([CRM_DEV, CRM_STAGE]);
    const projectAt = html.indexOf('data-zerops-surface="sidebar-project"');
    const project = html.slice(
      html.lastIndexOf("<div", projectAt),
      html.indexOf('data-zerops-surface="sidebar-mate"'),
    );
    expect(project).toContain("Beviro CRM");
    // A name, not a label: sentence case in the sidebar's own foreground.
    expect(project).not.toContain("uppercase");
    expect(project).not.toContain("micro-label");
    expect(project).toContain("font-semibold");
    expect(project).toContain("text-sidebar-foreground");

    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
    expect(html).toContain('data-zerops-primitive="mate-face"');
    expect(html).toContain('data-mate-face-size="sm"');
    expect(html).toContain(">Ready<");
    // A card: a bordered surface that presses, not a line of text.
    const cardAt = html.indexOf('data-zerops-surface="sidebar-mate"');
    const card = html.slice(html.lastIndexOf("<button", cardAt), cardAt);
    expect(card).toContain("border");
    expect(card).toContain("cursor-pointer");
    expect(card).toContain("active:scale-[0.99]");
  });

  it("folds the other environments under the project and counts them, the Mate's own left out", () => {
    const html = render([CRM_DEV, CRM_STAGE, CRM_PROD]);
    expect(html).toContain('data-zerops-surface="sidebar-environments-fold"');
    expect(html).toContain("2 environments");
    // Folded by default: the rows are not in the markup until opened.
    expect(html).not.toContain('data-zerops-surface="sidebar-environment-rows"');
    expect(html).toContain('aria-expanded="false"');
    // A project whose only environment is its Mate's has nothing to fold.
    expect(render([CRM_DEV])).not.toContain("sidebar-environments-fold");
  });

  it("never makes production a Mate, whatever runs in it", () => {
    const prodWithContainer = candidate("crm-prod", ["mate:g:aaa", "mate:role:prod"], "connected");
    const html = render([CRM_DEV, prodWithContainer]);
    expect(html.match(/data-zerops-surface="sidebar-mate"/gu)).toHaveLength(1);
    expect(html).toContain("1 environment");
  });

  it("gives two Mates two colours", () => {
    const html = render([CRM_DEV, LOOSE]);
    const tints = [...html.matchAll(/data-mate-face-tint="([a-z]+)"/gu)].map((match) => match[1]);
    expect(new Set(tints).size).toBe(2);
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
    // make a card vanish from under the user.
    const asleep: ZeropsCandidate = {
      ...CRM_DEV,
      group: "unavailable",
      reason: "container is STOPPED",
    };
    const html = render([asleep]);
    expect(html).toContain('data-mate-face-state="sleep"');
    expect(html).toContain("Unavailable");
  });

  it("keeps a declared Mate whose container is gone — the tag is its existence", () => {
    const declared = candidate("crm-dev", ["mate", "mate:g:aaa", "mate:role:dev"], "ready", false);
    expect(render([declared])).toContain('data-zerops-surface="sidebar-mate"');
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
    const html = render([CRM_STAGE]);
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
    const html = render([CRM_DEV, LOOSE], { activeProjectId: "loose" });
    expect(html).toContain('aria-current="true"');
    expect(html.match(/aria-current="true"/gu)).toHaveLength(1);
  });
});

describe("the Mate's card", () => {
  const NAMED = candidate("crm-dev", [
    "mate",
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

  it("leads with the agent's name — not the project's, not its tag", () => {
    const html = render([NAMED]);
    expect(html).toContain("Ada");
    expect(html).not.toContain(">crm-dev<");
    expect(html).not.toContain("role-tag");
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
    // The socket is the client's business; the card answers what the agent
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
