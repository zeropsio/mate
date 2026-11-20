/** Where Add stage or Add production opens its sheet: a route of this web app. */

/**
 * Whether *Add stage* or *Add production* opens its sheet over the page it was pressed on: the
 * projects page and the project's own page hold the form; anywhere else goes to the projects page
 * first, so closing the sheet never lands somewhere the person did not open.
 */
export function addsEnvironmentInPlace(pathname: string, groupId: string): boolean {
  return pathname === "/zerops" || pathname === `/group/${groupId}/flow`;
}
