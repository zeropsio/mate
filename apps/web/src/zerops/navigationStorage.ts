/**
 * Where a sign-in lands: once, on the deep link it started from, else on the projects page. No
 * route from an earlier visit is restored (the owner, 2026-10-02: landing on /zerops and then
 * jumping into some Mate "is very strange and disturbing").
 */
import { appBasePath } from "../basePath";
const PENDING = "mate:sign-in-return:v1";
function isProductPath(path: string | null): path is string {
  return (
    path !== null &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !/[?#\\]/.test(path) &&
    !["/", "/pair", "/zerops", "/zerops/", "/zerops/authorized"].includes(path)
  );
}
export function rememberSignInReturn(): void {
  try {
    const path = window.location.pathname.slice(appBasePath().length) || "/";
    if (isProductPath(path)) window.sessionStorage.setItem(PENDING, path);
    else window.sessionStorage.removeItem(PENDING);
  } catch {
    /* Navigation remains optional with storage blocked. */
  }
}
export function accountReturnPath(): string {
  try {
    const explicit = window.sessionStorage.getItem(PENDING);
    window.sessionStorage.removeItem(PENDING);
    return `${appBasePath()}${isProductPath(explicit) ? explicit : "/zerops"}`;
  } catch {
    return `${appBasePath()}/zerops`;
  }
}
