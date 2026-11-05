/**
 * An Adobe Express design a conversation's link asks the panel to open: the agent makes a design
 * with Adobe's tools and writes its address, and the person continues it in the panel.
 */
import { create } from "zustand";

const EXPRESS_HOSTS = new Set(["new.express.adobe.com", "express.adobe.com"]);

/** The design an Adobe Express link names (`https://new.express.adobe.com/id/<urn>`), or `null`. */
export function expressDesignId(href: string): string | null {
  if (!URL.canParse(href)) return null;
  const url = new URL(href);
  if (url.protocol !== "https:" || !EXPRESS_HOSTS.has(url.hostname)) return null;
  const match = /^\/id\/(urn(?::|%3A)aaid(?::|%3A)[^/]+)$/iu.exec(url.pathname);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/** What the panel is asked to open: a design a link named, or a picture from the conversation. */
export type ExpressOpenRequest =
  | { readonly kind: "design"; readonly documentId: string }
  | { readonly kind: "picture"; readonly picture: Blob; readonly name: string };

interface ExpressOpenState {
  readonly pending: (ExpressOpenRequest & { readonly id: number }) | null;
  readonly request: (request: ExpressOpenRequest) => void;
  /** Clears the request the panel acted on, never a newer one. */
  readonly take: (id: number) => void;
}

export const useExpressOpen = create<ExpressOpenState>((set) => ({
  pending: null,
  request: (request) =>
    set((state) => ({ pending: { ...request, id: (state.pending?.id ?? 0) + 1 } })),
  take: (id) => set((state) => (state.pending?.id === id ? { pending: null } : state)),
}));
