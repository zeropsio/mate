import { createFileRoute } from "@tanstack/react-router";

import { ZeropsChangeDetailPage } from "../components/zerops/ZeropsGroupDetail";

export const Route = createFileRoute("/_chat/change/$groupId/$repository/$number")({
  component: () => {
    const { groupId, repository, number } = Route.useParams();
    return (
      <ZeropsChangeDetailPage
        groupId={groupId}
        number={Number.parseInt(number, 10)}
        repository={repository}
      />
    );
  },
});
