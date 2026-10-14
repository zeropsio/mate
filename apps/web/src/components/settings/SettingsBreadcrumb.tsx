import { Link } from "@tanstack/react-router";

import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_SECTION_LABELS } from "./settingsSearch";

const SETTINGS_BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": "Diagnostics",
};

function settingsBreadcrumbLabel(pathname: string): string | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return SETTINGS_BREADCRUMB_LABELS[normalizedPathname] ?? null;
}

/** A page under the team — the invitation, or one person — says which, under *Team*. */
function teamPageLabel(pathname: string): string | null {
  const page = /^\/settings\/team\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (page === undefined) return null;
  return page === "invite" ? "Invite" : "Member";
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const sectionLabel = settingsBreadcrumbLabel(pathname);
  const teamPage = teamPageLabel(pathname);
  if (teamPage !== null)
    return (
      <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
        <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem>
          <Link className="hover:text-foreground" to="/settings/team">
            Team
          </Link>
        </WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem current>{teamPage}</WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
    );

  return (
    <WorkspaceBreadcrumb ariaLabel="Settings breadcrumb">
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>Settings</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="truncate">
        {sectionLabel ?? "Settings"}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}
