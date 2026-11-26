import { ZEROPS_MARK, ZEROPS_RING } from "@t3tools/shared/brand";

/**
 * Zerops' mark: the platform's two-tone Z by default, or `variant="company"`, the company's ring
 * where Zerops the company is meant ("Mate by Zerops", signing in with a Zerops account).
 * `tone="current"` draws it in the text colour — for a place that already has a colour, like a
 * filled button.
 */
export function ZeropsMark({
  className,
  tone = "brand",
  variant = "platform",
}: {
  className?: string;
  tone?: "brand" | "current";
  variant?: "platform" | "company";
}) {
  const mark = variant === "company" ? ZEROPS_RING : ZEROPS_MARK;
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-zerops-mark-tone={tone}
      data-zerops-mark-variant={variant}
      viewBox={mark.viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {mark.paths.map((path) => (
        <path d={path.d} fill={tone === "brand" ? path.fill : "currentColor"} key={path.d} />
      ))}
    </svg>
  );
}
