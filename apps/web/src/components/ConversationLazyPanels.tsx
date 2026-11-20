import { appLazy } from "../lib/appChunks";

export const AgentsPanel = appLazy(() =>
  import("./AgentsPanel").then((module) => ({ default: module.AgentsPanel })),
);
export const ZeropsBrowserSurface = appLazy(() =>
  import("./zerops/ZeropsBrowserSurface").then((module) => ({
    default: module.ZeropsBrowserSurface,
  })),
);
export const ZeropsMacSurface = appLazy(() =>
  import("./zerops/ZeropsMacSurface").then((module) => ({
    default: module.ZeropsMacSurface,
  })),
);
export const CodeChanges = appLazy(() =>
  import("./CodeChanges").then((module) => ({ default: module.CodeChanges })),
);
export const ZeropsGitSurface = appLazy(() =>
  import("./zerops/ZeropsGitSurface").then((module) => ({ default: module.ZeropsGitSurface })),
);
export const ZeropsDataPanel = appLazy(() =>
  import("./zerops/ZeropsDataPanel").then((module) => ({ default: module.ZeropsDataPanel })),
);
export const ZeropsChangeDetailPage = appLazy(() =>
  import("./zerops/ZeropsGroupDetail").then((module) => ({
    default: module.ZeropsChangeDetailPage,
  })),
);
export const CrewPanel = appLazy(() =>
  import("./zerops/crew/CrewPanel").then((module) => ({ default: module.CrewPanel })),
);
export const ZeropsProjectsPage = appLazy(() =>
  import("./zerops/ZeropsProjectsPage").then((module) => ({
    default: module.ZeropsProjectsPage,
  })),
);
export const McpPanel = appLazy(() =>
  import("./mcp/McpPanel").then((module) => ({ default: module.McpPanel })),
);
export const ExpressPanel = appLazy(() =>
  import("./express/ExpressPanel").then((module) => ({ default: module.ExpressPanel })),
);
export const PersonaPanel = appLazy(() =>
  import("./persona/PersonaPanel").then((module) => ({ default: module.PersonaPanel })),
);
export const ZeropsPanel = appLazy(() =>
  import("./zerops/ZeropsPanel").then((module) => ({ default: module.ZeropsPanel })),
);
export const VaultPanelContainer = appLazy(() =>
  import("./zerops/vault/VaultPanelContainer").then((module) => ({
    default: module.VaultPanelContainer,
  })),
);
export const FilePreviewPanel = appLazy(() => import("./files/FilePreviewPanel"));
