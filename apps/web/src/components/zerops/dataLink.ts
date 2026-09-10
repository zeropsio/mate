import { createContext } from "react";

/**
 * How a service card reaches its Data tab. The service map is a protected
 * root (design-system.md R2) — it renders and navigates, it never issues a
 * data request itself — so the opener is handed in by context, the same way
 * `ServiceBrowserLinkContext` hands in the browser opener. Absent means no
 * Data affordance is drawn at all.
 */
export const ZeropsDataLinkContext = createContext<((hostname: string) => void) | null>(null);
