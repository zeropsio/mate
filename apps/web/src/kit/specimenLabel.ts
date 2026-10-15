/** A prop value as a specimen's label writes it. */
type LabelValue = string | number | boolean | null | undefined;

/**
 * The JSX props a specimen renders with, spelled as they read in source: `variant="ghost" size="sm"`,
 * `disabled`, `open={false}`. Unset props are left out, so a specimen on its defaults says so.
 */
export function specimenLabel(props: Readonly<Record<string, LabelValue>>): string {
  const parts = Object.entries(props).flatMap(([name, value]) => {
    if (value === undefined) return [];
    if (value === true) return [name];
    if (typeof value === "string") return [`${name}="${value}"`];
    return [`${name}={${String(value)}}`];
  });
  return parts.length === 0 ? "(defaults)" : parts.join(" ");
}

/**
 * Every value of a component's variant union, in the order given. The record must name each member
 * exactly once, so a variant added to the kit fails the typecheck here until its specimen shows.
 */
export function variantsOf<Variant extends string>(
  members: Readonly<Record<Variant, true>>,
): readonly Variant[] {
  return Object.keys(members) as Variant[];
}
