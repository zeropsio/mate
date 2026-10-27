import type { ReactNode } from "react";

import { RenderErrorBoundary } from "~/components/RenderErrorBoundary";
import { ZeropsSessionContext } from "~/zerops/sessionContext";
import type { ZeropsSessionValue } from "~/zerops/ZeropsSessionProvider";

import { Specimen, SpecimenGrid } from "./Specimen";

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

/**
 * A census section's opening line: how many looks the app made for itself, in how many files, and
 * what the kit offers instead. The numbers are a grep of `apps/web/src` outside `components/ui`,
 * the kit page and tests, taken when the section was written.
 */
export function CensusCount({
  looks,
  components,
  files,
  kit,
}: {
  readonly looks: number;
  /** Named components behind those looks; a look several components share counts once. */
  readonly components?: number;
  readonly files: number;
  /** The kit's equivalent, named: "the kit has Button with 13 variants". */
  readonly kit: string;
}) {
  return (
    <p className="m-0 text-sm">
      {looks} looks
      {components === undefined ? null : ` from ${components} components`} in {files} files; {kit}.
    </p>
  );
}

/**
 * One home-made look: its name, how many files and places render it, and its specimens. A look the
 * page cannot render goes to the omissions list instead, never a copy of its markup.
 */
export function CensusLook({
  name,
  source,
  files,
  uses,
  note,
  children,
}: {
  readonly name: string;
  /**
   * Where the look is defined, repository-relative, when one component draws it. Unset, the look's
   * children are `CensusComponent`s, each naming its own.
   */
  readonly source?: string;
  readonly files: number;
  readonly uses: number;
  /** What sets it apart from its neighbours, in a few words. */
  readonly note?: string;
  readonly children: ReactNode;
}) {
  const where = `${files} ${files === 1 ? "file" : "files"}, ${uses} ${uses === 1 ? "place" : "places"}`;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-kit-census-look={name}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="m-0 font-medium text-sm">
          {name}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {where}
            {note === undefined ? null : ` · ${note}`}
          </span>
        </h3>
        {source === undefined ? null : (
          <code className="font-mono text-muted-foreground/70 text-xs">{source}</code>
        )}
      </div>
      {source === undefined ? (
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
      ) : (
        <SpecimenGrid>{children}</SpecimenGrid>
      )}
    </div>
  );
}

/** One of the components that share a look: its name and file once, then its specimens. */
export function CensusComponent({
  name,
  source,
  children,
}: {
  readonly name: string;
  readonly source: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
        <code className="font-mono font-medium">{name}</code>
        <code className="font-mono text-muted-foreground/70">{source}</code>
      </p>
      <SpecimenGrid>{children}</SpecimenGrid>
    </div>
  );
}

/** The looks of a census section, most used first. */
export function CensusLooks({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-col gap-8">{children}</div>;
}
