import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ZeropsGroupDetailPage } from "../components/zerops/ZeropsGroupDetail";
import { parseMirrorSearch } from "../components/zerops/gitMirror.logic";

function GroupFlowPage() {
  const { groupId } = Route.useParams();
  const { mirror } = Route.useSearch();
  // Read once: the address drops it (replaced, not pushed), so a reload or Back opens no dialog.
  const [mirrorReturned] = useState(mirror === groupId);
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (mirror !== undefined) void navigate({ search: {}, replace: true });
  }, [mirror, navigate]);
  return <ZeropsGroupDetailPage groupId={groupId} mirrorReturned={mirrorReturned} />;
}

/**
 * A project's own page. Three segments on purpose: a two-segment path is
 * indistinguishable from `/$environmentId/$threadId`, which is also two, and
 * a thread wins the match — the page rendered nothing at all.
 */
export const Route = createFileRoute("/_chat/group/$groupId/flow")({
  // `?mirror=<groupId>`: back from GitHub's install page, the mirror dialog opens again.
  validateSearch: (raw: Record<string, unknown>) => parseMirrorSearch(raw),
  component: GroupFlowPage,
});
