import { ZEROPS_MARK } from "@t3tools/shared/brand";

/**
 * The Zerops loop, two-tone by default. `tone="current"` draws it in the
 * text colour — for a place that already has a colour, like a filled button.
 */
export function ZeropsMark({
  className,
  tone = "brand",
}: {
  className?: string;
  tone?: "brand" | "current";
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-zerops-mark-tone={tone}
      viewBox={ZEROPS_MARK.viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {ZEROPS_MARK.paths.map((path) => (
        <path d={path.d} fill={tone === "brand" ? path.fill : "currentColor"} key={path.d} />
      ))}
    </svg>
  );
}
