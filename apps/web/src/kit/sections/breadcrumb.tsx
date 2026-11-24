import { InlineButton } from "~/components/ui/button";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

export default defineKitSection({
  id: "breadcrumb",
  title: "WorkspaceBreadcrumb",
  purpose:
    "Where a page or a panel's view sits: the places above it muted, each a way back, the current one in the foreground.",
  group: "Chosen",
  kind: "Navigation",
  source: "apps/web/src/components/WorkspaceBreadcrumb.tsx",
  render: () => (
    <SpecimenGrid>
      <Specimen label="a settings page under a section">
        <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
          <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem>
            <InlineButton tone="muted">Team</InlineButton>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current>Member</WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </Specimen>
      <Specimen label="the Data panel's path, truncated in 16rem">
        <div className="flex w-64">
          <WorkspaceBreadcrumb ariaLabel="Data path">
            <WorkspaceBreadcrumbItem>
              <InlineButton tone="muted">db</InlineButton>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem className="truncate" current>
              order_line_items_archive
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </div>
      </Specimen>
    </SpecimenGrid>
  ),
});
