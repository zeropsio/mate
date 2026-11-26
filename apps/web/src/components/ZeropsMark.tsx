import { ZEROPS_MARK, ZEROPS_RING, ZEROPS_WORDMARK } from "@t3tools/shared/brand";

/**
 * Zerops' mark: the platform's two-tone Z by default, or `variant="company"`, the company's ring
 * where Zerops the company is meant ("Mate by Zerops", signing in with a Zerops account).
 * `tone="current"` draws it in the text colour — for a place that already has a colour, like a
 * filled button. `named` sets the word "zerops" after it, in the text colour, as the logo in a
 * page's corner: its holder gives it a height, its width follows.
 */
export function ZeropsMark({
  className,
  tone = "brand",
  variant = "platform",
  named = false,
}: {
  className?: string;
  tone?: "brand" | "current";
  variant?: "platform" | "company";
  /** The word "zerops" after the mark: the logo. */
  named?: boolean;
}) {
  const mark = variant === "company" ? ZEROPS_RING : ZEROPS_MARK;
  const paths = mark.paths.map((path) => (
    <path d={path.d} fill={tone === "brand" ? path.fill : "currentColor"} key={path.d} />
  ));
  if (named)
    return (
      <svg
        aria-label="Zerops"
        className={className}
        data-zerops-mark-tone={tone}
        data-zerops-mark-variant={variant}
        role="img"
        viewBox={`0 0 ${ZEROPS_WORDMARK.width} ${ZEROPS_WORDMARK.height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <svg
          height={ZEROPS_WORDMARK.height}
          viewBox={mark.viewBox}
          width={ZEROPS_WORDMARK.markWidth}
        >
          {paths}
        </svg>
        <path d={ZEROPS_WORDMARK.d} fill="currentColor" />
      </svg>
    );
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-zerops-mark-tone={tone}
      data-zerops-mark-variant={variant}
      viewBox={mark.viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {paths}
    </svg>
  );
}
