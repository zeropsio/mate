/**
 * Where Zerops' build e-mails land: they name a pipeline by the legacy app's path, so Mate's
 * origin answers the same path with the pipeline dialog over the projects (`?pipeline=`). It
 * hands over only once the person is signed in — a sign-in keeps this path, never a search — and
 * the dialog switches to the pipeline's organization itself.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/service-stack/$serviceId/deploy/$appVersionId")({
  component: PipelineLanding,
});

function PipelineLanding() {
  const { appVersionId } = Route.useParams();
  // The projects page itself: home forwards there and would drop the search on the way.
  return <Navigate replace search={{ pipeline: appVersionId }} to="/zerops" />;
}
