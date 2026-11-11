/**
 * A page's top line on a phone. There the menu's button stands fixed in the screen's corner, so a
 * page's frame (`ZeropsHostedFrame`) draws one bar beside it that stays put while the page scrolls
 * beneath: the button is never over a title or a row. What a page says first — its title, or its
 * trail — is drawn in that bar instead of at the top of the page.
 */
import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The bar's element where the page's frame draws one, `null` until it stands, `undefined` where
 * there is none (a desktop, a page outside the frame): there the line stays in the page.
 */
export const PhoneBarContext = createContext<HTMLElement | null | undefined>(undefined);

/** Whether this page's first line is drawn in the phone's bar. */
export function useInPhoneBar(): boolean {
  return use(PhoneBarContext) !== undefined;
}

/** The page's first line: in the phone's bar where the frame draws one, in place elsewhere. */
export function InPhoneBar({ children }: { readonly children: ReactNode }) {
  const bar = use(PhoneBarContext);
  if (bar === undefined) return children;
  return bar === null ? null : createPortal(children, bar);
}
