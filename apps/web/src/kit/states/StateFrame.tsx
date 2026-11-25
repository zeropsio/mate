import type { ReactNode } from "react";

/**
 * The room a page-sized state is drawn in: a fixed frame, so a stage that fills its parent or sits
 * at its foot shows at a size you can compare beside the others.
 */
export function StateFrame({
  size = "card",
  children,
}: {
  readonly size?: "line" | "card" | "page";
  readonly children: ReactNode;
}) {
  const box =
    size === "page"
      ? "h-[560px] w-[760px]"
      : size === "card"
        ? "min-h-40 w-[440px]"
        : "min-h-12 w-[440px]";
  return (
    <div className={`relative flex min-w-0 flex-col overflow-hidden rounded-card border ${box}`}>
      {children}
    </div>
  );
}
