import { holdAppearance } from "~/hooks/useTheme";
import { flowThemeOf, KIT_FLOWS } from "~/kit/kitFlows";

/**
 * The design harness's one page (`design/index.html`, `vite.config.ts`): every `design*.html`
 * address answers with it, and it loads the harness that page names, alone, under its title. Any
 * other address (`/design/`, the hosted harness's root) is the kit: every component, and these
 * pages as its flows. Each `design*.html` stays what names a harness: its title and its module.
 */
const modules = import.meta.glob("/src/design/*Harness.tsx");

/**
 * The appearance every harness page draws in, from its query (`flowThemeOf`): held as the page's
 * own (`holdAppearance`), so the root class and every component that asks the app's theme agree,
 * and the person's stored preference stays theirs. A harness that hands the appearance to a
 * component reads it from here.
 */
export const harnessAppearance = flowThemeOf(location.search);

const here = KIT_FLOWS.find(({ href }) => href === location.pathname);
const load = here === undefined ? undefined : modules[here.module];

if (here !== undefined && load !== undefined) {
  document.title = `Mate — ${here.title}`;
  holdAppearance(harnessAppearance);
  void load();
} else {
  void import("./harnessKit");
}
