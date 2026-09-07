import { accountLocalStorage } from "./accountLifetime";
import { appBasePath } from "../basePath";
const PENDING = "mate:sign-in-return:v1";
const LAST = "last-route:v1";
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
export function rememberAccountRoute(path: string): void {
  try {
    if (isProductPath(path)) accountLocalStorage.setItem(LAST, path);
  } catch {
    /* Optional preference. */
  }
}
export function accountReturnPath(): string {
  try {
    const explicit = window.sessionStorage.getItem(PENDING);
    window.sessionStorage.removeItem(PENDING);
    const last = accountLocalStorage.getItem(LAST);
    return `${appBasePath()}${isProductPath(explicit) ? explicit : isProductPath(last) ? last : "/zerops"}`;
  } catch {
    return `${appBasePath()}/zerops`;
  }
}
