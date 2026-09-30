import { createFileRoute } from "@tanstack/react-router";

import { ZeropsNewProjectComingPage } from "../components/zerops/ZeropsNewProjectComingPage";

/**
 * A New project's first Mate's own view before the platform has made its project, by the
 * creation's id: where Create lands, until the Mate's view by its project takes the route
 * (`/mate/$projectId`) in its place.
 */
export const Route = createFileRoute("/_chat/mate/new/$birthId")({
  component: () => {
    const { birthId } = Route.useParams();
    return <ZeropsNewProjectComingPage key={birthId} birthId={birthId} />;
  },
});
