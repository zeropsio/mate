import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";

/** Preview eligibility depends only on a domain associated with a service. */
export function serviceForPreview(
  href: string,
  services: ReadonlyArray<Pick<ZeropsTopologyService, "hostname" | "routes">> | undefined,
): string | null {
  try {
    const url = new URL(href);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password)
      return null;
    return (
      services?.find((service) =>
        service.routes.some((route) => new URL(route.url).hostname === url.hostname),
      )?.hostname ?? null
    );
  } catch {
    return null;
  }
}

export function isServiceBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}
