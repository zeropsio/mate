/**
 * The Zerops GUI this client links to: every "Open in Zerops" deep link and the sign-in
 * hand-over. One per build, named once at start by the client that knows its platform
 * (the web's `VITE_ZEROPS_APP_URL`); `app.zerops.io` until then.
 *
 * @module zerops/gui
 */

/** Where the platform's own client lives, and the only place sign-up works. */
export const DEFAULT_ZEROPS_GUI_URL = "https://app.zerops.io";

let guiBase = DEFAULT_ZEROPS_GUI_URL;

/** Names this build's GUI; blank keeps `app.zerops.io`. Called once, before the first render. */
export function configureZeropsGui(url: string | undefined): void {
  guiBase = url?.trim().replace(/\/+$/u, "") || DEFAULT_ZEROPS_GUI_URL;
}

/** The GUI's own origin, for the hand-over's `/authorize-app`. */
export const zeropsGuiBase = (): string => guiBase;

/** Zerops' own dashboard, the same deep link zcp hands out on a launch failure. */
export const zeropsProjectUrl = (projectId: string): string => `${guiBase}/project/${projectId}`;

/** The service's own page in the Zerops dashboard, the GUI's `/service-stack/:id` route. */
export const serviceDashboardUrl = (serviceId: string): string =>
  `${guiBase}/service-stack/${serviceId}`;

/** The GUI page where a person makes a personal access token. */
export const zeropsTokenManagementUrl = (): string => `${guiBase}/settings/token-management`;
