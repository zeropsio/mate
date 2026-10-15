import type { ReactNode } from "react";

import { RenderErrorBoundary } from "~/components/RenderErrorBoundary";
import { ZeropsSessionContext } from "~/zerops/sessionContext";
import type { ZeropsSessionValue } from "~/zerops/ZeropsSessionProvider";

import { Specimen } from "./Specimen";

/**
 * Where a home-made look is drawn and how much of the app draws it: the census row a specimen
 * stands for. `uses` counts JSX sites outside tests, harnesses and the kit.
 */
export interface CensusEntry {
  readonly source: string;
  readonly uses: number;
  readonly files: number;
}

export function censusLine({ source, uses, files }: CensusEntry): string {
  const sites = `${uses} ${uses === 1 ? "use" : "uses"} in ${files} ${files === 1 ? "file" : "files"}`;
  return `${source} · ${sites}`;
}

/**
 * One home-made look, rendered by its real component. A specimen that throws says so in place, so
 * one broken look leaves the rest of its census standing (and the page's render test red).
 */
export function CensusSpecimen({
  label,
  entry,
  children,
}: {
  readonly label: string;
  readonly entry: CensusEntry;
  readonly children: ReactNode;
}) {
  return (
    <Specimen label={label} source={censusLine(entry)}>
      <RenderErrorBoundary fallback={<span className="text-sm">{label} failed to render</span>}>
        {children}
      </RenderErrorBoundary>
    </Specimen>
  );
}

/** The made-up person every census specimen is drawn for: no client, so nothing reaches Zerops. */
const KIT_VIEWER = {
  status: "signed-in",
  user: {
    id: "u-kit",
    email: "petra@example.com",
    firstName: "Petra",
    lastName: "Malá",
    fullName: "Petra Malá",
  },
  organizations: [],
  activeOrganization: null,
} as unknown as ZeropsSessionValue;

/**
 * Stands the census in a session of its own, so a look that names its viewer names the fixture's
 * person, never whoever opened /kit.
 */
export function KitViewer({ children }: { readonly children: ReactNode }) {
  return (
    <ZeropsSessionContext.Provider value={KIT_VIEWER}>{children}</ZeropsSessionContext.Provider>
  );
}
