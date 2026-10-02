/**
 * The changes a text links, read back as the changes they are.
 *
 * A Mate writes its change's address at HQ into its conversation — the address HQ redirects into
 * the app — and the app draws that change in place of the bare address, places its landing on the
 * timeline, and finds the run that made it. Only the organization's official HQ is recognised
 * (`parseChangeUrl`): an address anywhere else is somebody else's and stays the link it is, and
 * while the official HQ is not known nothing is claimed.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module changeLinks
 */
import { parseChangeUrl, type ChangeLink } from "@t3tools/shared/hqChanges";

/** A url as prose and markdown carry it: up to whitespace, a bracket or a quote. */
const URL_IN_TEXT = /https?:\/\/[^\s<>()[\]"'`]+/gu;
/** What ends a sentence around a url rather than the url itself. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;

/** Every change of the official HQ at `hqAddress` that `text` links, in the order it links them. */
export function linkedChanges(
  text: string,
  hqAddress: string | undefined,
): ReadonlyArray<ChangeLink> {
  if (hqAddress === undefined) return [];
  const links: Array<ChangeLink> = [];
  for (const [url] of text.matchAll(URL_IN_TEXT)) {
    const link = parseChangeUrl(url.replace(TRAILING_PUNCTUATION, ""), hqAddress);
    if (link !== null) links.push(link);
  }
  return links;
}

/** Whether `text` links the change `link` names. */
export function linksChange(
  text: string,
  link: ChangeLink,
  hqAddress: string | undefined,
): boolean {
  return linkedChanges(text, hqAddress).some(
    (linked) =>
      linked.appId === link.appId && linked.repo === link.repo && linked.number === link.number,
  );
}
