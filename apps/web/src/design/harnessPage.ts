import { holdAppearance } from "~/hooks/useTheme";
import { flowFramedOf, flowThemeOf, KIT_FLOWS } from "~/kit/kitFlows";

import type { DesignFlow } from "./mount";

/**
 * The design harness's one page (`design/index.html`, `vite.config.ts`): every `design*.html`
 * address answers with it, and it mounts the named flow or loads the legacy harness. Any other
 * address (`/design/`, the hosted harness's root) is the kit: every component and these flows.
 */
const modules = import.meta.glob("/src/design/*Harness.tsx");
const flows = import.meta.glob<{ default: DesignFlow }>("/src/design/*.flow.tsx");

/**
 * The appearance every harness page draws in, from its query (`flowThemeOf`): held as the page's
 * own (`holdAppearance`), so the root class and every component that asks the app's theme agree,
 * and the person's stored preference stays theirs. A harness that hands the appearance to a
 * component reads it from here.
 */
export const harnessAppearance = flowThemeOf(location.search);

/**
 * The kit frames this page (`flowFramedOf`): a harness that lists its own states leaves the list
 * out, since the kit's picker above the frame stands for it. Opened alone, the page keeps it.
 */
export const harnessFramed = flowFramedOf(location.search);

const here = KIT_FLOWS.find(({ href }) => href === location.pathname);
const load = here === undefined ? undefined : modules[here.module];
const loadFlow = here === undefined ? undefined : flows[here.module];

if (here !== undefined && (loadFlow !== undefined || load !== undefined)) {
  document.title = `Mate — ${here.title}`;
  holdAppearance(harnessAppearance);
  if (loadFlow !== undefined) {
    const state = new URLSearchParams(location.search).get("state");
    void Promise.all([
      loadFlow(),
      import("./mount"),
      import("react-dom/client"),
      import("../index.css"),
    ]).then(([{ default: flow }, { stateElement }, { createRoot }]) => {
      const host = document.getElementById("design");
      if (host === null) throw new Error("The design page has no mount point");
      createRoot(host).render(stateElement(flow, state ?? flow.defaultState));
    });
  } else {
    void load?.();
  }
} else {
  void import("./harnessKit");
}
