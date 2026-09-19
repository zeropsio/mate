import { createFileRoute } from "@tanstack/react-router";

import { ZeropsGroupDetailPage } from "../components/zerops/ZeropsGroupDetail";

/**
 * A project's own page. Three segments on purpose: a two-segment path is
 * indistinguishable from `/$environmentId/$threadId`, which is also two, and
 * a thread wins the match — the page rendered nothing at all.
 */
export const Route = createFileRoute("/_chat/group/$groupId/flow")({
  component: () => <ZeropsGroupDetailPage groupId={Route.useParams().groupId} />,
});
