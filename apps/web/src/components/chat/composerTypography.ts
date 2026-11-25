/**
 * A picture or a file in the composer's text: on a row of its own, 80 px tall, the ones written
 * one after another side by side on it, wrapping like a gallery (`data-attachment-slot`).
 */
export const COMPOSER_ATTACHMENT_SLOT_CLASS_NAME =
  "inline-block max-w-full my-2 me-2 align-bottom leading-0";

/**
 * Words never share a row with attachments: an empty block after the words before a run and
 * before the words after it breaks their line, and stands no taller than nothing.
 */
export const COMPOSER_ATTACHMENT_RUNS_CLASS_NAME =
  "[&_span:not([data-attachment-slot]):has(+[data-attachment-slot])]:after:block [&_[data-attachment-slot]+:not([data-attachment-slot],br)]:before:block";

export const COMPOSER_PROMPT_TYPE_CLASS_NAME =
  "relative [font-family:var(--font-composer,var(--font-sans))] [font-size:var(--font-size-prompt,0.875rem)] [@media(max-width:39.999rem)_and_(pointer:coarse)]:[font-size:max(var(--font-size-prompt,1rem),16px)]";
