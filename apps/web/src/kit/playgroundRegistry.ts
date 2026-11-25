import type { KitPlayground } from "./kitPlayground";

// Every file in `playground/` is a playground of the section it names: dropping one in is the
// whole registration, and a section without one opens on its variants. A section with several
// (Button and InlineButton) lists them in their files' order.
const modules = import.meta.glob<{ default: KitPlayground }>("./playground/*.tsx", {
  eager: true,
});

export const KIT_PLAYGROUNDS: ReadonlyMap<string, readonly KitPlayground[]> = Map.groupBy(
  Object.values(modules).map((module) => module.default),
  (playground) => playground.section,
);
