/**
 * What a surface attached over the composer says to its drawn shell (base.css): the banners and
 * the command and stash menus floating over it are a translucent lift over the canvas, on the
 * raised surface; the composer and its own top drawer wear the card.
 */
export const COMPOSER_ATTACHED_RAISED = "[--chat-composer-attached-surface:var(--surface-raised)]";

/** Its outline where no variant tints it: the composer's own, else the top bar's edge. */
export const COMPOSER_ATTACHED_OUTLINE =
  "not-data-variant:[--chat-composer-attached-outline:var(--chat-composer-outline,var(--composer-attached-outline))] data-[variant=default]:[--chat-composer-attached-outline:var(--chat-composer-outline,var(--composer-attached-outline))]";
