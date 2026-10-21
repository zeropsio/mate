/** Where in the repository a page is: the repository, then each folder down to the file or folder. */
import type { MouseEvent } from "react";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "~/components/WorkspaceBreadcrumb";
import { MiddleTruncate } from "~/components/ui/middle-truncate";
import type { RepoPathTarget } from "./RepoMarkdown";

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** Each step of a path, the repository first: every one but the last is a folder. */
export const pathSteps = (target: RepoPathTarget): ReadonlyArray<RepoPathTarget> => {
  const segments = target.path === "" ? [] : target.path.split("/");
  return [
    { path: "", kind: "tree" },
    ...segments.map((_, index) => ({
      path: segments.slice(0, index + 1).join("/"),
      kind: index === segments.length - 1 ? target.kind : ("tree" as const),
    })),
  ];
};

export function GitPathCrumbs({
  repo,
  at,
  hrefOf,
  onOpen,
}: {
  readonly repo: string;
  readonly at: RepoPathTarget;
  readonly hrefOf: (target: RepoPathTarget) => string;
  readonly onOpen: (target: RepoPathTarget) => void;
}) {
  const steps = pathSteps(at);
  return (
    <WorkspaceBreadcrumb ariaLabel="Path">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const name = step.path === "" ? repo : step.path.slice(step.path.lastIndexOf("/") + 1);
        return [
          index === 0 ? null : <WorkspaceBreadcrumbSeparator key={`/${step.path}`} />,
          <WorkspaceBreadcrumbItem key={step.path} current={last}>
            <a
              className="flex min-w-0 font-mono text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={hrefOf(step)}
              aria-current={last ? "page" : undefined}
              onClick={(event) => {
                if (!plainClick(event)) return;
                event.preventDefault();
                onOpen(step);
              }}
            >
              <MiddleTruncate value={name} />
            </a>
          </WorkspaceBreadcrumbItem>,
        ];
      })}
    </WorkspaceBreadcrumb>
  );
}
