import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

import { ZeropsOrganizationScope, ZeropsOrganizationSwitcher } from "./ZeropsOrganizationScope";

const organizations: ReadonlyArray<ZeropsOrganization> = [
  {
    id: "org-owner",
    membershipId: "cu-owner",
    name: "Acme",
    roleCode: "OWNER",
  },
  {
    id: "org-dev",
    membershipId: "cu-dev",
    name: "Jan Saidl",
    roleCode: "NO_ACCESS",
    canCreateProjects: true,
  },
];

describe("ZeropsOrganizationScope", () => {
  it("is the page while no organization is chosen: a title and one card per membership", () => {
    const markup = renderToStaticMarkup(
      <ZeropsOrganizationScope
        organizations={organizations}
        status="needs-selection"
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("<h1");
    expect(markup).toContain("Choose an organization");
    expect(markup).toContain("Acme");
    expect(markup).toContain("Owner");
    expect(markup).toContain("Jan Saidl");
    expect(markup).toContain("Developer");
    expect(markup.match(/data-zerops-organization-choice/g)).toHaveLength(2);
    expect(markup).toContain("data-zerops-organization-card");
    // The grid fills the page's width; it is not a narrow column in a wide frame.
    expect(markup).toContain("sm:grid-cols-2 lg:grid-cols-3");
    expect(markup).not.toContain("max-w-3xl");
    expect(markup).not.toContain('data-slot="button"');
    // The bar above already says whose product this is.
    expect(markup).not.toContain("micro-label");
  });

  it("says when there is nothing to choose from", () => {
    const markup = renderToStaticMarkup(
      <ZeropsOrganizationScope organizations={[]} status="needs-selection" onSelect={() => {}} />,
    );
    expect(markup).toContain("No active Zerops organizations.");
  });
});

describe("ZeropsOrganizationSwitcher", () => {
  it("shows the active membership as a switchable control with no label of its own", () => {
    const markup = renderToStaticMarkup(
      <ZeropsOrganizationSwitcher
        activeOrganization={organizations[1]!}
        organizations={organizations}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("Jan Saidl");
    expect(markup).toContain("Developer");
    expect(markup).toContain('aria-label="Active Zerops organization"');
    expect(markup).not.toContain("micro-label");
  });
});
