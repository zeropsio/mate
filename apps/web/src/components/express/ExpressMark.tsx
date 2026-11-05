/**
 * Adobe Express's mark: the app tile with its letter cut out, the path Adobe's own Embed SDK draws,
 * the letter showing Express's gradient through it. Its colours are Adobe's, kept in the picture
 * file rather than the theme. Adobe's brand rules for integrations govern where it may appear.
 */
import expressMarkUrl from "./expressMark.svg";

export function ExpressMark({ className }: { readonly className?: string }) {
  return (
    <img alt="" aria-hidden="true" className={className} draggable={false} src={expressMarkUrl} />
  );
}
