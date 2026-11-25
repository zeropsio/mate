import { HistoryIcon } from "lucide-react";

import { MiddleTruncate } from "./ui/middle-truncate";
import { Text } from "~/components/ui/text";

export function PreviousWorktreeItemContent({ branch }: { branch: string | null }) {
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <HistoryIcon className="mt-1 size-3" />
      <span className="flex min-w-0 flex-col">
        <span>Previous worktree</span>
        {branch ? (
          <Text className="min-w-0" variant="note">
            <MiddleTruncate value={branch} />
          </Text>
        ) : null}
      </span>
    </span>
  );
}
