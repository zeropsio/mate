/**
 * The Data panel's path line: service root → schema → table, one crumb per
 * path prefix (`breadcrumbsFor`, client-runtime).
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

export interface ZeropsDataBreadcrumbsProps {
  readonly path: ZeropsDataConsolePath;
  readonly onNavigate: (path: ZeropsDataConsolePath) => void;
}

export function ZeropsDataBreadcrumbs({ path, onNavigate }: ZeropsDataBreadcrumbsProps) {
  const crumbs = breadcrumbsFor(path);

  return (
    <nav
      aria-label="Data path"
      className="flex min-w-0 flex-wrap items-center gap-1 text-xs"
      data-zerops-data-breadcrumbs
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span className="flex items-center gap-1" key={crumb.path.segments.join("/")}>
            {index > 0 ? <span className="text-muted-foreground">/</span> : null}
            {last ? (
              <span
                className="truncate font-semibold text-foreground"
                data-zerops-data-breadcrumb-current
              >
                {crumb.label}
              </span>
            ) : (
              <button
                className="truncate text-muted-foreground hover:text-foreground"
                data-zerops-data-breadcrumb={crumb.label}
                onClick={() => onNavigate(crumb.path)}
                type="button"
              >
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
