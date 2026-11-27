import { createFileRoute } from "@tanstack/react-router";

import { ZeropsGroupDetailPage } from "../components/zerops/ProjectPage";

/**
 * A project's own page with its Board in view: the address a link to an application's tasks
 * opens (the page's *Board*, the menu's, a task waiting for its putter's answer). The page is the
 * one at `/group/$groupId/flow`; only where it opens differs, so a reload, Back or Forward lands on
 * the Board again.
 */
export const Route = createFileRoute("/_chat/group/$groupId/board")({
  component: () => {
    const { groupId } = Route.useParams();
    return <ZeropsGroupDetailPage board groupId={groupId} />;
  },
});
