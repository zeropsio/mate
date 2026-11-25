/**
 * The Data panel's path line: service root → schema → table, one crumb per
 * path prefix (`breadcrumbsFor`, client-runtime), as every other breadcrumb
 * (`WorkspaceBreadcrumb`).
 *
 * NOT a protected root (design-system.md R2): it navigates, it never issues
 * a request of its own — the caller (`ZeropsDataPanel`) decides what a crumb
 * click loads.
 *
 * The last crumb is the current location, so it renders as inert text: in
 * the narrow layout the earlier crumbs are the only way back to the tree,
 * and a "click where you already are" target would be a dead control there.
 */
import { breadcrumbsFor } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsolePath } from "@t3tools/contracts";
import { Fragment } from "react";

import { InlineButton } from "~/components/ui/button";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";

interface ZeropsDataBreadcrumbsProps {
  /** Segments the tree collapses away — they get no crumb (`db / orders`, not `db / public / orders`). */
  readonly collapsedPrefix?: ReadonlyArray<string>;
  readonly path: ZeropsDataConsolePath;
  readonly onNavigate: (path: ZeropsDataConsolePath) => void;
}

export function ZeropsDataBreadcrumbs({
  path,
  onNavigate,
  collapsedPrefix,
}: ZeropsDataBreadcrumbsProps) {
  const crumbs = breadcrumbsFor(path, collapsedPrefix);

  return (
    <WorkspaceBreadcrumb ariaLabel="Data path">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <Fragment key={crumb.path.segments.join("/")}>
            {index > 0 ? <WorkspaceBreadcrumbSeparator /> : null}
            <WorkspaceBreadcrumbItem className={last ? "truncate" : ""} current={last}>
              {last ? (
                crumb.label
              ) : (
                <InlineButton onClick={() => onNavigate(crumb.path)} tone="muted">
                  {crumb.label}
                </InlineButton>
              )}
            </WorkspaceBreadcrumbItem>
          </Fragment>
        );
      })}
    </WorkspaceBreadcrumb>
  );
}
