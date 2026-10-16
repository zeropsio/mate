/**
 * Settings → Team, from a made-up organization seen by its owner: the team as cards (`TeamList`),
 * one person's own page (`TeamMemberView`) and the invitation (`TeamInviteView`).
 *
 * Served by the dev server at `/design-team.html` (`?theme=dark`), beside a blank left menu at the
 * owner's 435 px; open it at 1786 × 1000. `?page=member` shows a developer's page with two
 * project grants (`&who=` another key: `cu-karel` an admin, `cu-iva` an invitation, `cu-me`
 * your own; `&viewer=ADMIN` as an admin sees it; `&advanced=1` a custom role with Advanced open;
 * `&picker=1` the project picker open). `?page=invite` the invitation, empty (`&from=g-snap` as
 * opened from Snap's ···); `&step=details` a new address checked, its names asked, a guest
 * (`&role=developer` a Developer). The team's invitation is named as its inviter typed it.
 * Fixtures only: no route imports this module.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { presetMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { TeamInviteView } from "~/components/settings/TeamInvitePage";
import { TeamMemberView } from "~/components/settings/TeamMemberPage";
import { TeamList } from "~/components/settings/TeamSettings";
import {
  teamPeople,
  type TeamInput,
  type TeamPlace,
} from "~/components/settings/teamSettings.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const viewerRole = params.get("viewer") ?? "OWNER";
const MENU_WIDTH = 435;

const member = (
  id: string,
  fullName: string,
  roleCode: string,
  extra: Partial<ZeropsOrganizationMember> = {},
): ZeropsOrganizationMember => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id, fullName, email: `${fullName.toLowerCase().replace(/\W+/g, ".")}@example.com` },
  ...extra,
});

const MEMBERS = [
  member("me", "Ada Lovelace", "OWNER"),
  member("karel", "Karel Novak", "ADMIN"),
  member("petra", "Petra Kralova", "OWNER"),
  member("jan", "Jan Svoboda", "NO_ACCESS", { canCreateProjects: true }),
  member("eva", "Eva Dvorakova", "NO_ACCESS"),
  member("tomas", "Tomas Benes", "BASIC_USER", {
    canCreateProjects: true,
  }),
  member("lucie", "Lucie Horakova", "ADMIN"),
  member("iva", "iva.mala@example.com", "NO_ACCESS", {
    status: "WAITING_AUTHORIZATION",
    user: { id: "iva", email: "iva.mala@example.com" },
  }),
  { id: "cu-token", status: "ACTIVE", roleCode: "ADMIN", user: { email: "token-x@zerops.io" } },
];

const place = (key: string, name: string): TeamPlace => ({ key, name, groupId: key });
const SNAP = place("g-snap", "Snap");
const BEVIRO = place("g-beviro", "Beviro");
const SHOP = place("g-shop", "Shop");

const grants = (entries: Record<string, string>) => ({
  status: "ready" as const,
  value: Object.entries(entries).map(([projectId, roleCode]) => ({ projectId, roleCode })),
});

const INPUT: TeamInput = {
  members: { known: true, status: "ready", refused: false, list: MEMBERS },
  grants: {
    "cu-jan": grants({ "snap-prod": "ADMIN", "beviro-prod": "ADMIN" }),
    "cu-eva": grants({
      "snap-prod": "READ_ONLY",
      "beviro-prod": "READ_ONLY",
      "shop-prod": "ADMIN",
    }),
    "cu-iva": grants({ "snap-prod": "READ_ONLY" }),
  },
  places: { "snap-prod": SNAP, "beviro-prod": BEVIRO, "shop-prod": SHOP },
  pictures: {},
  viewerUserId: "me",
  invitedNames: { "iva.mala@example.com": "Iva Mala" },
  viewer: { roleCode: viewerRole, membershipId: viewerRole === "OWNER" ? "cu-me" : "cu-karel" },
};

const PROJECTS = [
  { projectId: "beviro-prod", label: "Beviro · production" },
  { projectId: "beviro-stage", label: "Beviro · stage" },
  { projectId: "shop-prod", label: "Shop · production" },
  { projectId: "snap-fen", label: "Snap · Fen" },
  { projectId: "snap-prod", label: "Snap · production" },
  { projectId: "snap-stage", label: "Snap · stage" },
  { projectId: "legacy", label: "legacy-api" },
];

const INVITABLE = [
  { key: "g-beviro", name: "Beviro", projectIds: ["beviro-prod", "beviro-stage"] },
  { key: "legacy", name: "legacy-api", projectIds: ["legacy"] },
  { key: "g-shop", name: "Shop", projectIds: ["shop-prod"] },
  { key: "g-snap", name: "Snap", projectIds: ["snap-prod", "snap-stage", "snap-fen"] },
];

const VIEW = teamPeople(INPUT);
const never = () => new Promise<never>(() => {});

function Page() {
  const page = params.get("page");
  const who = params.get("who") ?? "cu-jan";
  useEffect(() => {
    if (params.get("picker") !== "1") return;
    const timer = setTimeout(() => {
      document.querySelector<HTMLElement>('[data-zerops-surface="set-custom-access"]')?.click();
    }, 250);
    return () => clearTimeout(timer);
  }, []);
  if (VIEW.kind !== "people") return null;
  if (page === "member") {
    const found = VIEW.people.find(({ key }) => key === who)!;
    const person =
      params.get("advanced") === "1"
        ? { ...found, membership: { ...presetMembership("developer"), canViewFinances: true } }
        : found;
    return (
      <TeamMemberView
        actions={{ updateMembership: never, saveAccess: never, remove: never }}
        grants={
          who === "cu-karel"
            ? { "shop-prod": "READ_ONLY" }
            : { "snap-prod": "ADMIN", "beviro-prod": "READ_ONLY", "snap-fen": "OWNER" }
        }
        organizationName="Acme"
        person={person}
        projects={PROJECTS}
        viewerRole={viewerRole}
      />
    );
  }
  if (page === "invite") {
    const details = params.get("step") === "details";
    const role = params.get("role") === "developer" ? "developer" : "guest";
    return (
      <TeamInviteView
        actions={{ check: never, send: never }}
        from={params.get("from") ?? (details ? "g-snap" : undefined)}
        initialAnswer={details ? { kind: "new" } : undefined}
        initialEmail={details ? "petra.kralova@example.com" : ""}
        initialMembership={presetMembership(details ? role : "developer")}
        onSent={() => {}}
        organizationName="Acme"
        projects={INVITABLE}
        viewerRole={viewerRole}
      />
    );
  }
  return <TeamList view={VIEW} />;
}

function HarnessPage() {
  const narrow = params.get("page") === "member" || params.get("page") === "invite";
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU_WIDTH }} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div
          className={
            narrow
              ? "mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pt-10 pb-12"
              : "mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-10 pb-12"
          }
        >
          <Page />
        </div>
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: HarnessPage });
const router = createRouter({
  routeTree: rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/settings/team/$clientUserId" }),
  ]),
  history: createMemoryHistory(),
});

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
