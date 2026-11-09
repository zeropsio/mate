import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ZeropsGroupDetailPage } from "../components/zerops/ZeropsGroupDetail";
import { parseHad, parseMirrorSearch } from "../components/zerops/gitMirror.logic";
import { rememberReturn } from "../components/zerops/github/githubConnect.logic";

function GroupFlowPage() {
  const { groupId } = Route.useParams();
  const { mirror, repo, had } = Route.useSearch();
  // Read once: the address drops it (replaced, not pushed), so a reload or Back opens no dialog.
  const [connectReturned] = useState(() => {
    if (mirror !== groupId) return null;
    // What was there before the trip, so the picker tells what GitHub added.
    if (repo !== undefined) rememberReturn(groupId, repo, parseHad(had));
    return { repo };
  });
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (mirror !== undefined) void navigate({ search: {}, replace: true });
  }, [mirror, navigate]);
  return <ZeropsGroupDetailPage connectReturned={connectReturned} groupId={groupId} />;
}

/**
 * A project's own page. Three segments on purpose: a two-segment path is
 * indistinguishable from `/$environmentId/$threadId`, which is also two, and
 * a thread wins the match — the page rendered nothing at all.
 */
export const Route = createFileRoute("/_chat/group/$groupId/flow")({
  // `?mirror=<groupId>&repo=<name>`: back from GitHub's install page, the connect dialog opens again.
  validateSearch: (raw: Record<string, unknown>) => parseMirrorSearch(raw),
  component: GroupFlowPage,
});
