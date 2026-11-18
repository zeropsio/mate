import { zeropsProjectUrl } from "@t3tools/client-runtime/zerops/gui";
import { ArrowUpRightIcon } from "lucide-react";

import { Row } from "../ui/row";
import { ZeropsMark } from "../ZeropsMark";

/**
 * A project only Platform holds, by name: no face, since no Mate lives there; pressing it opens the
 * project's own page in Platform, in a tab of its own.
 */
export function PlatformProjectRow({
  projectId,
  name,
}: {
  readonly projectId: string;
  readonly name: string;
}) {
  return (
    <div
      className="menu-unit group/platform flex flex-col transition-colors hover:bg-sidebar-row-hover"
      data-zerops-platform-project={projectId}
    >
      <Row
        lead={
          <span aria-hidden="true" className="menu-project-mark">
            <ZeropsMark className="size-4" tone="current" />
          </span>
        }
        meta={
          <ArrowUpRightIcon
            aria-hidden="true"
            className="size-4 text-sidebar-muted-foreground opacity-0 transition-opacity group-hover/platform:opacity-100 group-has-[:focus-visible]/platform:opacity-100 pointer-coarse:opacity-100"
          />
        }
        pressable="band"
        render={
          <a
            aria-label={`${name}, open in Platform`}
            data-zerops-surface="sidebar-platform-project"
            href={zeropsProjectUrl(projectId)}
            rel="noreferrer"
            target="_blank"
          />
        }
        size="lg-line"
        title={<span className="text-sidebar-muted-foreground">{name}</span>}
      />
    </div>
  );
}
