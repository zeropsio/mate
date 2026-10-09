/**
 * The composer's notice stack — one notice, and two with the second stacked behind — attached to
 * the composer's own frame.
 *
 * Served by the dev server at `/design-notice-stack.html` (`?theme=dark`). Fixtures only: nothing
 * here ships, and no route imports this module.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CpuIcon, ShrinkIcon } from "lucide-react";

import {
  ComposerBannerStack,
  type ComposerBannerStackItem,
} from "~/components/chat/ComposerBannerStack";
import { Button } from "~/components/ui/button";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const appearance = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";

const CPU: ComposerBannerStackItem = {
  id: "cpu",
  variant: "default",
  layout: "centered",
  icon: <CpuIcon />,
  title: "Fen is under CPU pressure",
};
const COMPACT: ComposerBannerStackItem = {
  id: "compact",
  variant: "info",
  icon: <ShrinkIcon />,
  title: "Resume with less context",
  description: "180k tokens from an older session",
  actions: (
    <Button size="xs" variant="outline">
      Compact
    </Button>
  ),
  onDismiss: () => {},
};

function Composer({
  items,
  label,
}: {
  readonly items: ComposerBannerStackItem[];
  readonly label: string;
}) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="pt-6">
        <ComposerBannerStack className="relative z-0" items={items} />
        <div
          className="relative z-10 w-full overflow-hidden rounded-3xl border border-border bg-card"
          data-chat-composer-main-surface="true"
        >
          <div className="px-4 pt-3 pb-12 text-placeholder text-sm">
            Describe what you want to build or change…
          </div>
        </div>
      </div>
    </section>
  );
}

function Harness() {
  return (
    <div className="flex min-h-screen flex-col items-center gap-10 bg-background p-10 text-foreground">
      <Composer items={[COMPACT]} label="One notice" />
      <Composer items={[COMPACT, CPU]} label="Two notices" />
      <Composer items={[CPU, COMPACT]} label="Two notices, centred front" />
    </div>
  );
}

applyThemePalette(ZEROPS_THEME_ID, appearance);
const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
