import { mateHealthCopy, type MateHealthRead } from "@t3tools/client-runtime/data";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

export function mateHealthBannerItem(input: {
  readonly name: string;
  readonly read: MateHealthRead;
  readonly projectUrl?: string;
}): ComposerBannerStackItem | null {
  const copy = mateHealthCopy(input.name, input.read);
  if (copy === null) return null;
  const canOpen = input.read.health?.evidence.resources.some(
    (resource) => resource === "memory" || resource === "disk",
  );
  return {
    id: "mate-health",
    variant: "warning",
    icon: null,
    title: copy.title,
    description: copy.description,
    ...(canOpen && input.projectUrl
      ? {
          actions: (
            <Button
              render={<a href={input.projectUrl} target="_blank" rel="noreferrer" />}
              size="md"
              variant="primary"
            >
              Open in Zerops
            </Button>
          ),
        }
      : {}),
  };
}
