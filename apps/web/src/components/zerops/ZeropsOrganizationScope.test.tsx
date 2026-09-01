import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";

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
  it("requires an explicit organization choice for a new multi-account session", () => {
    const markup = renderToStaticMarkup(
      <ZeropsOrganizationScope
        activeOrganization={null}
        organizations={organizations}
        status="needs-selection"
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("Choose an organization");
    expect(markup).toContain("Acme");
    expect(markup).toContain("Owner");
    expect(markup).toContain("Jan Saidl");
    expect(markup).toContain("Developer");
    expect(markup.match(/data-zerops-organization-choice/g)).toHaveLength(2);
    expect(markup).toContain("data-zerops-organization-card");
    expect(markup).toContain("max-w-3xl");
    expect(markup).toContain("min-h-20");
    expect(markup).not.toContain('data-slot="button"');
  });

  it("shows the active membership as a switchable account scope", () => {
    const markup = renderToStaticMarkup(
      <ZeropsOrganizationScope
        activeOrganization={organizations[1]!}
        organizations={organizations}
        status="selected"
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("Organization");
    expect(markup).toContain("Jan Saidl");
    expect(markup).toContain("Developer");
    expect(markup).toContain('aria-label="Active Zerops organization"');
  });
});
