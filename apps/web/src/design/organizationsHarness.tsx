/**
 * The organization choice, as a person in several organizations meets it after signing in: the
 * screen alone (`ZeropsOrganizationChoice`), the first organization focused.
 *
 * Served by the dev server at `/design-organizations.html` (`?theme=dark`); open it at 1786 × 1000.
 * `?count=0` an account in no organization; `?signout=fails` Sign out failing. A pick says which
 * organization it took under the card.
 * Fixtures only: no route imports this module.
 */
import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { ZeropsOrganizationChoice } from "~/components/zerops/ZeropsOrganizationScope";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";

const ORGANIZATIONS: ReadonlyArray<ZeropsOrganization> = [
  { id: "c-north", name: "Northwind Studio", membershipId: "cu-north", roleCode: "OWNER" },
  { id: "c-acme", name: "Acme Retail", membershipId: "cu-acme", roleCode: "ADMIN" },
  {
    id: "c-lab",
    name: "Open Source Lab with a rather long organization name",
    membershipId: "cu-lab",
    roleCode: "DEVELOPER",
  },
];

function HarnessPage() {
  const [picked, setPicked] = useState<string | null>(null);
  const organizations = params.get("count") === "0" ? [] : ORGANIZATIONS;
  return (
    <>
      <ZeropsOrganizationChoice
        email="marie.cerna@example.com"
        organizations={organizations}
        onSelect={(membershipId) =>
          setPicked(organizations.find((each) => each.membershipId === membershipId)?.name ?? null)
        }
        onSignOut={() =>
          new Promise((resolve, reject) =>
            setTimeout(
              () => (params.get("signout") === "fails" ? reject(new Error("refused")) : resolve()),
              600,
            ),
          )
        }
      />
      {picked === null ? null : (
        <p className="fixed inset-x-0 bottom-16 text-center text-xs text-muted-foreground">
          Picked {picked}
        </p>
      )}
    </>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
document.documentElement.classList.toggle("dark", appearance === "dark");
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <HarnessPage />
  </StrictMode>,
);
