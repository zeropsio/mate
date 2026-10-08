import { Window } from "happy-dom";

/** Read rendered markup as a document, so assertions follow content and accessible attributes. */
export function markupDom(markup: string) {
  const document = new Window().document;
  document.body.innerHTML = markup;
  return document;
}
