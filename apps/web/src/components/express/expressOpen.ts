/**
 * What the conversation asks the panel's Express to open: a design the agent made with Adobe's
 * tools and linked, a picture from the conversation to edit, or a step of a Mate's picture ask.
 */
import { create } from "zustand";

import type { PictureAsk } from "../ask/pictureAsk.logic";

const EXPRESS_HOSTS = new Set(["new.express.adobe.com", "express.adobe.com"]);

/** The design an Adobe Express link names (`https://new.express.adobe.com/id/<urn>`), or `null`. */
export function expressDesignId(href: string): string | null {
  if (!URL.canParse(href)) return null;
  const url = new URL(href);
  if (url.protocol !== "https:" || !EXPRESS_HOSTS.has(url.hostname)) return null;
  const match = /^\/id\/(urn(?::|%3A)aaid(?::|%3A)[^/]+)$/iu.exec(url.pathname);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

/**
 * What the panel is asked to open: a design a link named, a picture from the conversation, or one
 * step of a picture ask, set up as the Mate wrote it.
 */
export type ExpressOpenRequest =
  | { readonly kind: "design"; readonly documentId: string }
  | { readonly kind: "picture"; readonly picture: Blob; readonly name: string }
  | { readonly kind: "ask"; readonly ask: PictureAsk; readonly step: number };

interface ExpressOpenState {
  readonly pending: (ExpressOpenRequest & { readonly id: number }) | null;
  readonly request: (request: ExpressOpenRequest) => void;
  /** Clears the request the panel acted on, never a newer one. */
  readonly take: (id: number) => void;
  /** The picture ask step open in Express now: its card says so until it is saved or left. */
  readonly working: { readonly key: string; readonly step: number } | null;
  readonly work: (step: { readonly key: string; readonly step: number } | null) => void;
}

export const useExpressOpen = create<ExpressOpenState>((set) => ({
  pending: null,
  request: (request) =>
    set((state) => ({ pending: { ...request, id: (state.pending?.id ?? 0) + 1 } })),
  take: (id) => set((state) => (state.pending?.id === id ? { pending: null } : state)),
  working: null,
  work: (working) => set({ working }),
}));
