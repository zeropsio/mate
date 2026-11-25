import type { ReactNode } from "react";

import { ShareBar, type ShareBarPart } from "~/components/ui/share-bar";
import { Text } from "~/components/ui/text";

/**
 * One part-to-whole split under its heading, for cost or tokens split by type or speed: the kit's
 * `ShareBar` with its legend, and an aside at the heading's end. Nothing renders without a total.
 */
export function UsageShareBar({
  label,
  segments,
  format,
  aside,
}: {
  readonly label: string;
  readonly segments: readonly ShareBarPart[];
  readonly format: (value: number) => string;
  readonly aside?: ReactNode;
}) {
  if (!segments.some((segment) => segment.value > 0)) return null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <Text render={<h3 />} variant="heading">
          {label}
        </Text>
        {aside}
      </div>
      <ShareBar format={format} label={label} legend parts={segments} />
    </div>
  );
}
