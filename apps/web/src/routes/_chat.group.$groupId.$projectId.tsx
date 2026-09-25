import { createFileRoute } from "@tanstack/react-router";

import { ZeropsStopDetailPage } from "../components/zerops/ZeropsGroupDetail";

export const Route = createFileRoute("/_chat/group/$groupId/$projectId")({
  component: () => {
    const { groupId, projectId } = Route.useParams();
    // Keyed by the stop: another stop is another page, with none of this one's
    // opened rows, shown releases or first-drawn time.
    return (
      <ZeropsStopDetailPage
        groupId={groupId}
        key={`${groupId}/${projectId}`}
        projectId={projectId}
      />
    );
  },
});
