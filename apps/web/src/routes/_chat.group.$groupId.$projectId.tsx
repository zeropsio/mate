import { createFileRoute } from "@tanstack/react-router";

import { ZeropsStopDetailPage } from "../components/zerops/ZeropsGroupDetail";

export const Route = createFileRoute("/_chat/group/$groupId/$projectId")({
  component: () => {
    const { groupId, projectId } = Route.useParams();
    return <ZeropsStopDetailPage groupId={groupId} projectId={projectId} />;
  },
});
