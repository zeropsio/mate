import { CheckIcon, ExternalLinkIcon, LinkIcon, ScanIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Toggle as PressToggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import {
  KIT_GROUNDS,
  KIT_VIEWPORTS,
  KIT_ZOOMS,
  type KitGround,
  type KitView,
  type KitZoom,
} from "../kitAppearance";
import { Segmented } from "./Segmented";

/** Which of the canvas's tools the page has: a document page has none, a flow draws its own ground. */
export interface KitToolSet {
  readonly both: boolean;
  readonly viewport: boolean;
  readonly ground: boolean;
  readonly zoom: boolean;
  readonly outline: boolean;
}

export const DOCUMENT_TOOLS: KitToolSet = {
  both: false,
  viewport: false,
  ground: false,
  zoom: false,
  outline: false,
};
export const CANVAS_TOOLS: KitToolSet = {
  both: true,
  viewport: true,
  ground: true,
  zoom: true,
  outline: true,
};
export const FLOW_TOOLS: KitToolSet = {
  both: true,
  viewport: true,
  ground: false,
  zoom: true,
  outline: false,
};

const FILL = "fill";
const VIEWPORT_ITEMS = [
  { value: FILL, label: "Fill" },
  ...KIT_VIEWPORTS.map(({ width, label }) => ({
    value: String(width),
    label: `${label} ${width}`,
  })),
];

const ZOOM_VALUES = KIT_ZOOMS.map(String);

const GROUND_LABEL: Readonly<Record<KitGround, string>> = {
  page: "Page",
  card: "Card",
  menu: "Menu",
};

/** An icon press with its name in a tooltip under it. */
function IconTool({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The current page's bar: where it is, then the canvas's tools (appearance, width, ground, zoom,
 * outline), opening the canvas alone and copying the page's address.
 */
export function KitToolbar({
  trail,
  tools,
  view,
  viewport,
  ground,
  zoom,
  outline,
  aloneHref,
  onChange,
}: {
  readonly trail: ReactNode;
  readonly tools: KitToolSet;
  readonly view: KitView;
  readonly viewport: number | undefined;
  readonly ground: KitGround;
  readonly zoom: KitZoom;
  readonly outline: boolean;
  readonly aloneHref: string | undefined;
  readonly onChange: (change: {
    readonly appearance?: KitView;
    readonly viewport?: number | undefined;
    readonly bg?: KitGround;
    readonly zoom?: KitZoom;
    readonly outline?: boolean;
  }) => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "link" });
  const viewportValue = viewport === undefined ? FILL : String(viewport);
  const viewportItems = VIEWPORT_ITEMS.some((item) => item.value === viewportValue)
    ? VIEWPORT_ITEMS
    : [...VIEWPORT_ITEMS, { value: viewportValue, label: `Custom ${viewportValue}` }];

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-body">{trail}</div>
      <div className="flex shrink-0 items-center gap-2">
        <Segmented
          disabled={tools.both ? [] : ["both"]}
          label="Appearance"
          names={{ light: "Light", dark: "Dark", both: "Both" }}
          onChange={(appearance) => onChange({ appearance })}
          value={view}
          values={["light", "dark", "both"]}
        />
        {tools.viewport ? (
          <div className="w-36">
            <Select
              items={viewportItems}
              onValueChange={(next) => {
                if (typeof next !== "string") return;
                onChange({ viewport: next === FILL ? undefined : Number(next) });
              }}
              value={viewportValue}
            >
              <SelectTrigger aria-label="Canvas width" size="compact">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {viewportItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ) : null}
        {tools.ground ? (
          <Segmented
            label="Ground"
            names={GROUND_LABEL}
            onChange={(bg) => onChange({ bg })}
            value={ground}
            values={KIT_GROUNDS}
          />
        ) : null}
        {tools.zoom ? (
          <Segmented
            label="Zoom"
            names={{ "100": "100%", "75": "75%", "50": "50%" }}
            onChange={(next) => {
              const chosen = KIT_ZOOMS.find((step) => String(step) === next);
              if (chosen !== undefined) onChange({ zoom: chosen });
            }}
            value={String(zoom)}
            values={ZOOM_VALUES}
          />
        ) : null}
        {tools.outline ? (
          <IconTool label={outline ? "Hide outlines" : "Outline every box"}>
            <PressToggle
              aria-label="Outline every box"
              onPressedChange={(pressed) => onChange({ outline: pressed })}
              pressed={outline}
              size="sm"
            >
              <ScanIcon />
            </PressToggle>
          </IconTool>
        ) : null}
        <Separator className="h-5" orientation="vertical" />
        {aloneHref === undefined ? null : (
          <IconTool label="Open the canvas alone">
            <Button
              aria-label="Open the canvas alone"
              render={<a href={aloneHref} rel="noreferrer" target="_blank" />}
              size="icon-sm"
              variant="ghost"
            >
              <ExternalLinkIcon />
            </Button>
          </IconTool>
        )}
        <IconTool label={isCopied ? "Link copied" : "Copy a link to this view"}>
          <Button
            aria-label={isCopied ? "Link copied" : "Copy a link to this view"}
            onClick={() => copyToClipboard(location.href, undefined)}
            size="icon-sm"
            variant="ghost"
          >
            {isCopied ? <CheckIcon /> : <LinkIcon />}
          </Button>
        </IconTool>
      </div>
    </header>
  );
}
