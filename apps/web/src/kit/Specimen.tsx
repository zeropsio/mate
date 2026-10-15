import { Fragment, type ReactNode } from "react";

import { specimenLabel } from "./specimenLabel";

/**
 * One rendered thing and the exact props it rendered with. A home-made specimen also names the file
 * it was copied from, so a census row leads back to the code it stands for.
 */
export function Specimen({
  label,
  source,
  children,
}: {
  /** The props as written in source; `specimenLabel` spells an object. */
  readonly label: string;
  readonly source?: string;
  readonly children: ReactNode;
}) {
  return (
    <figure className="m-0 flex min-w-0 max-w-full flex-col items-start gap-2" data-kit-specimen="">
      <div className="flex min-h-9 min-w-0 max-w-full items-center">{children}</div>
      <figcaption className="flex min-w-0 max-w-full flex-col gap-0.5">
        <code className="font-mono text-muted-foreground text-xs">{label}</code>
        {source ? (
          <code className="font-mono text-muted-foreground/70 text-xs">{source}</code>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Specimens side by side, wrapping. */
export function SpecimenGrid({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-x-8 gap-y-6">{children}</div>;
}

/** A titled run of specimens inside a section: "Variants × sizes", "States". */
export function SpecimenBlock({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="m-0 font-medium text-muted-foreground text-xs">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Every row value against every column value of two props: its headers carry the exact props, so
 * a cell's label is its row's plus its column's.
 */
export function SpecimenMatrix<Row extends string, Column extends string>({
  rowProp,
  rows,
  columnProp,
  columns,
  render,
}: {
  readonly rowProp: string;
  readonly rows: readonly Row[];
  readonly columnProp: string;
  readonly columns: readonly Column[];
  readonly render: (row: Row, column: Column) => ReactNode;
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div
        className="grid w-max items-center gap-x-4 gap-y-3"
        style={{ gridTemplateColumns: `auto repeat(${columns.length}, auto)` }}
      >
        <span />
        {columns.map((column) => (
          <code className="font-mono text-muted-foreground text-xs" key={column}>
            {specimenLabel({ [columnProp]: column })}
          </code>
        ))}
        {rows.map((row) => (
          <Fragment key={row}>
            <code className="font-mono text-muted-foreground text-xs">
              {specimenLabel({ [rowProp]: row })}
            </code>
            {columns.map((column) => (
              <div className="flex items-center" key={column}>
                {render(row, column)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
