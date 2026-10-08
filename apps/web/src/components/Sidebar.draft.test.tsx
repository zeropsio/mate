import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { TooltipProvider } from "./ui/tooltip";

const source = vi.hoisted(() => ({ url: "" }));
// Give the original favicon a resolvable image projection rather than an
// unknown environment: restoring media to this row must fail the assertion.
vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlState: () => ({ _tag: "Success", url: source.url }),
}));
import { SidebarDraftRow } from "./Sidebar";

it.each([
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/%3E',
  "data:image/svg+xml,invalid",
])("draft rows show text without media even when their image source resolves: %s", (url) => {
  source.url = url;
  const draftId = DraftId.make("resolvable-draft");
  useComposerDraftStore
    .getState()
    .setPrompt(draftId, `Liu opened Zerops Mate.\n![picture](${url})`);
  const props = {
    draftId,
    composer: useComposerDraftStore.getState().getComposerDraft(draftId)!,
    projectTitle: "Imperial Titan",
    projectCwd: "/workspace",
    projectFaviconPath: "favicon.svg",
    session: {
      threadId: ThreadId.make(draftId),
      environmentId: EnvironmentId.make("resolvable-environment"),
      projectId: ProjectId.make("workspace"),
      logicalProjectKey: "workspace",
      createdAt: "2026-10-08T00:00:00Z",
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      branch: null,
      worktreePath: null,
      envMode: "local" as const,
      startFromOrigin: false,
    },
    isActive: false,
    onNavigate: () => {},
    onDiscard: () => {},
  };
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <SidebarDraftRow {...props} />
    </TooltipProvider>,
  );
  expect(html).toContain("Liu opened Zerops Mate.");
  expect(html).not.toMatch(/<img|asset-image-frame|asset-image-unavailable/);
});
