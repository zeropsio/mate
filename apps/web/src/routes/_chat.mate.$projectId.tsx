import { createFileRoute } from "@tanstack/react-router";

import { ZeropsMateComingPage } from "../components/zerops/ZeropsMateComingPage";

/**
 * A new Mate's own view while it comes up, by the project the platform made for it: where Add
 * lands, and where its row opens until it is up. Keyed by the project: another Mate is another
 * view, with none of this one's hand-over.
 */
export const Route = createFileRoute("/_chat/mate/$projectId")({
  component: () => {
    const { projectId } = Route.useParams();
    return <ZeropsMateComingPage key={projectId} projectId={projectId} />;
  },
});
