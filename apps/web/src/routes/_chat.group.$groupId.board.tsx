import { createFileRoute } from "@tanstack/react-router";

import { BoardPage } from "../components/zerops/projectAutomation/BoardPage";

/** `?task=<id>`: the task whose panel stands open; anything else, none. */
function boardSearch(raw: Record<string, unknown>): { readonly task?: string } {
  return typeof raw.task === "string" && raw.task !== "" ? { task: raw.task } : {};
}

function BoardRoute() {
  const { groupId } = Route.useParams();
  const { task } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <BoardPage
      groupId={groupId}
      onTask={(next) => {
        // Moving from task to task replaces the address: Back leaves the Board, not each task.
        void navigate({ search: next === null ? {} : { task: next }, replace: true });
      }}
      task={task ?? null}
    />
  );
}

/**
 * An application's Board on its own page: the address a link to its tasks opens (the project
 * page's Board and its rows, the menu's, a task waiting for its putter's answer), with the task
 * picked in `?task=`, so a reload, Back or Forward lands on it again.
 */
export const Route = createFileRoute("/_chat/group/$groupId/board")({
  validateSearch: boardSearch,
  component: BoardRoute,
});
