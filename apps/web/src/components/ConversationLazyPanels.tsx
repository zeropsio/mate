import { lazy } from "react";
import { appChunk } from "../lib/appChunks";

export const AgentsPanel = lazy(
  appChunk(() => import("./AgentsPanel").then((module) => ({ default: module.AgentsPanel }))),
);
export const ZeropsBrowserSurface = lazy(
  appChunk(() =>
    import("./zerops/ZeropsBrowserSurface").then((module) => ({
      default: module.ZeropsBrowserSurface,
    })),
  ),
);
export const ZeropsMacSurface = lazy(
  appChunk(() =>
    import("./zerops/ZeropsMacSurface").then((module) => ({
      default: module.ZeropsMacSurface,
    })),
  ),
);
export const CodeChanges = lazy(
  appChunk(() => import("./CodeChanges").then((module) => ({ default: module.CodeChanges }))),
);
export const ZeropsGitSurface = lazy(
  appChunk(() =>
    import("./zerops/ZeropsGitSurface").then((module) => ({ default: module.ZeropsGitSurface })),
  ),
);
export const ZeropsDataPanel = lazy(
  appChunk(() =>
    import("./zerops/ZeropsDataPanel").then((module) => ({ default: module.ZeropsDataPanel })),
  ),
);
export const ZeropsChangeDetailPage = lazy(
  appChunk(() =>
    import("./zerops/ZeropsGroupDetail").then((module) => ({
      default: module.ZeropsChangeDetailPage,
    })),
  ),
);
export const CrewPanel = lazy(
  appChunk(() =>
    import("./zerops/crew/CrewPanel").then((module) => ({ default: module.CrewPanel })),
  ),
);
export const ZeropsProjectsPage = lazy(
  appChunk(() =>
    import("./zerops/ZeropsProjectsPage").then((module) => ({
      default: module.ZeropsProjectsPage,
    })),
  ),
);
export const McpPanel = lazy(
  appChunk(() => import("./mcp/McpPanel").then((module) => ({ default: module.McpPanel }))),
);
export const ExpressPanel = lazy(
  appChunk(() =>
    import("./express/ExpressPanel").then((module) => ({ default: module.ExpressPanel })),
  ),
);
export const PersonaPanel = lazy(
  appChunk(() =>
    import("./persona/PersonaPanel").then((module) => ({ default: module.PersonaPanel })),
  ),
);
export const ZeropsPanel = lazy(
  appChunk(() =>
    import("./zerops/ZeropsPanel").then((module) => ({ default: module.ZeropsPanel })),
  ),
);
export const VaultPanelContainer = lazy(
  appChunk(() =>
    import("./zerops/vault/VaultPanelContainer").then((module) => ({
      default: module.VaultPanelContainer,
    })),
  ),
);
export const FilePreviewPanel = lazy(appChunk(() => import("./files/FilePreviewPanel")));
