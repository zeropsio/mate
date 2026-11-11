/**
 * Where the empty link (`/`) opens: the overview, on Mine when HQ places a Mate of the reader's
 * own, else on All, where a first visit adds one. A Chief is the organization's, never a project's
 * card, so it never fills Mine. Pure.
 */
import type { ProjectsSearch } from "../components/zerops/projects/projectsView.logic";

export function homeOverviewSearch(
  facts: Readonly<
    Record<
      string,
      { readonly mine?: boolean | undefined; readonly chief?: "mine" | "another" | undefined }
    >
  >,
): ProjectsSearch {
  return Object.values(facts).some((person) => person.mine === true && person.chief === undefined)
    ? { show: "mine" }
    : {};
}
