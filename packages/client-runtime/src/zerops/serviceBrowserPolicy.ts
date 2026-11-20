import type { ZeropsTopologyService } from "./topology.ts";

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
