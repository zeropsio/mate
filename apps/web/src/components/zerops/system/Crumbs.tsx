/**
 * A page's trail, outermost first — Overview / Tea Shop / Production — each step but the last a
 * press that opens the page it names (`pageTrail`).
 */
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";

import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../../WorkspaceBreadcrumb";
import { pageTrail } from "./Crumbs.logic";

/** One step of a trail: its words, and the press that opens its page; none on the page itself. */
export interface Crumb {
  readonly label: string;
  readonly onClick?: (() => void) | undefined;
}

/**
 * A page's trail as crumbs, each step's press navigating to its page. Props as `pageTrail`:
 * `project` (`{ groupId, name }`, name `undefined` while unread) and `here` (the page's own name
 * past the project; absent on the project's page).
 */
export function usePageTrail(input: {
  readonly project?: { readonly groupId: string; readonly name: string | undefined } | undefined;
  readonly here?: string | undefined;
}): ReadonlyArray<Crumb> {
  const navigate = useNavigate();
  const groupId = input.project?.groupId;
  const name = input.project?.name;
  const { here } = input;
  return useMemo(
    () =>
      pageTrail({
        project: groupId === undefined ? undefined : { groupId, name },
        here,
      }).map(({ label, to }) => ({
        label,
        onClick:
          to === undefined
            ? undefined
            : () => {
                void (to.kind === "overview"
                  ? navigate({ to: "/zerops" })
                  : navigate({ to: "/group/$groupId/flow", params: { groupId: to.groupId } }));
              },
      })),
    [groupId, name, here, navigate],
  );
}

/** Props: `trail` (from `usePageTrail`, or any `Crumb`s). The last step without `onClick` is the page. */
export function Crumbs({ trail }: { readonly trail: ReadonlyArray<Crumb> }) {
  return (
    // One element across the overview's pages (`page-crumbs`, index.css): going from a project to
    // its place the shared steps hold still and only the last one changes.
    <WorkspaceBreadcrumb ariaLabel="Breadcrumb" className="page-crumbs min-w-0">
      {trail.map((crumb, index) => (
        <Fragment key={`${String(index)}:${crumb.label}`}>
          {index === 0 ? null : <WorkspaceBreadcrumbSeparator />}
          <WorkspaceBreadcrumbItem className="min-w-0 shrink" current={crumb.onClick === undefined}>
            {crumb.onClick === undefined ? (
              <span aria-current="page" className="min-w-0 truncate">
                {crumb.label}
              </span>
            ) : (
              <button
                className="min-w-0 cursor-pointer truncate rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={crumb.onClick}
                type="button"
              >
                {crumb.label}
              </button>
            )}
          </WorkspaceBreadcrumbItem>
        </Fragment>
      ))}
    </WorkspaceBreadcrumb>
  );
}
