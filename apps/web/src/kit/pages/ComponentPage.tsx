import { CheckIcon, CircleCheckIcon, CircleXIcon, CopyIcon, RotateCcwIcon } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { PageHeader } from "~/components/ui/page-header";
import { Row } from "~/components/ui/row";
import { Section } from "~/components/ui/section";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Tab, TabStrip } from "~/components/ui/tab-strip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import type { KitArgs, KitControl, KitPlayground } from "../kitPlayground";
import type { KitGroup, KitSection } from "../kitSection";
import { Segmented } from "../shell/Segmented";
import { SectionBoundary } from "./SectionBoundary";

export const COMPONENT_TABS = ["playground", "variants", "usage"] as const;
export type ComponentTab = (typeof COMPONENT_TABS)[number];

const TAB_LABEL: Readonly<Record<ComponentTab, string>> = {
  playground: "Playground",
  variants: "Variants",
  usage: "Usage",
};

const STATUS: Readonly<
  Record<KitGroup, { tone: "success" | "neutral" | "warning"; label: string }>
> = {
  Chosen: { tone: "success", label: "Chosen" },
  Kit: { tone: "neutral", label: "Kit" },
  "Home-made": { tone: "warning", label: "Home-made" },
};

/** The tabs a section has: a playground only where one is defined, usage where it is written. */
export function componentTabs(playground: KitPlayground | undefined): readonly ComponentTab[] {
  return COMPONENT_TABS.filter(
    (tab) =>
      (tab !== "playground" || playground !== undefined) &&
      (tab !== "usage" || playground?.usage !== undefined),
  );
}

/** The line that imports a kit component, read from where it lives. */
export function importLine(
  section: KitSection,
  playground: KitPlayground | undefined,
): string | undefined {
  if (playground !== undefined) return playground.imports;
  const match = /^apps\/web\/src\/(components\/ui\/[\w-]+)\.tsx$/u.exec(section.source);
  if (match === null) return undefined;
  return `import { ${section.title} } from "~/${match[1]}";`;
}

/** A read-only line of code with its copy press: a path, an import. */
function CopyField({ label, value }: { readonly label: string; readonly value: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: label });
  return (
    <InputGroup>
      <InputGroupInput aria-label={label} font="mono" readOnly size="sm" value={value} />
      <InputGroupAddon align="inline-end">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={isCopied ? `${label} copied` : `Copy the ${label.toLowerCase()}`}
                onClick={() => copyToClipboard(value, undefined)}
                size="icon-xs"
                variant="ghost"
              />
            }
          >
            {isCopied ? <CheckIcon /> : <CopyIcon />}
          </TooltipTrigger>
          <TooltipPopup>{isCopied ? "Copied" : `Copy the ${label.toLowerCase()}`}</TooltipPopup>
        </Tooltip>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** A component's head: name, purpose, who made it, where it lives and how to import it. */
function ComponentHeader({
  section,
  imports,
  tabs,
  tab,
  onTabChange,
}: {
  readonly section: KitSection;
  readonly imports: string | undefined;
  readonly tabs: readonly ComponentTab[];
  readonly tab: ComponentTab;
  readonly onTabChange: (tab: ComponentTab) => void;
}) {
  const status = STATUS[section.group];
  const list = useRef<HTMLDivElement | null>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    if (next === undefined) return;
    onTabChange(next);
    requestAnimationFrame(() => {
      list.current?.querySelector<HTMLElement>(`[data-tab-id="${next}"]`)?.focus();
    });
  };
  return (
    <div className="flex shrink-0 flex-col gap-4 border-b px-8 pt-6">
      <PageHeader
        actions={
          <>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone="neutral">{section.kind}</Badge>
          </>
        }
        line={section.purpose}
        title={section.title}
      />
      <div className="grid grid-cols-2 gap-3">
        <CopyField label="Source" value={section.source} />
        {imports === undefined ? null : <CopyField label="Import" value={imports} />}
      </div>
      <div
        aria-label={`${section.title} views`}
        className="flex pb-2"
        onKeyDown={onKeyDown}
        ref={list}
        role="tablist"
      >
        <TabStrip
          activeId={tab}
          items={tabs.map((id) => ({ id, label: TAB_LABEL[id] }))}
          onSelect={(id) => {
            const chosen = tabs.find((candidate) => candidate === id);
            if (chosen !== undefined) onTabChange(chosen);
          }}
        >
          {tabs.map((id) => (
            <Tab
              active={id === tab}
              aria-controls={`kit-tab-${id}`}
              aria-selected={id === tab}
              key={id}
              onClick={() => onTabChange(id)}
              render={<button type="button" />}
              role="tab"
              size="md"
              tabId={id}
              tabIndex={id === tab ? 0 : -1}
            >
              {TAB_LABEL[id]}
            </Tab>
          ))}
        </TabStrip>
      </div>
    </div>
  );
}

function ControlInput({
  name,
  control,
  value,
  onChange,
}: {
  readonly name: string;
  readonly control: KitControl;
  readonly value: string | boolean;
  readonly onChange: (value: string | boolean) => void;
}) {
  if (control.kind === "boolean") {
    return (
      <Switch
        aria-label={name}
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked)}
      />
    );
  }
  if (control.kind === "text") {
    return (
      <div className="w-56">
        <Input
          aria-label={name}
          onChange={(event) => onChange(event.currentTarget.value)}
          size="sm"
          value={typeof value === "string" ? value : ""}
        />
      </div>
    );
  }
  const current = typeof value === "string" ? value : (control.options[0] ?? "");
  if (control.options.length <= 4) {
    return (
      <Segmented
        label={name}
        names={Object.fromEntries(control.options.map((option) => [option, option]))}
        onChange={onChange}
        value={current}
        values={control.options}
      />
    );
  }
  const items = control.options.map((option) => ({ value: option, label: option }));
  return (
    <div className="w-44">
      <Select
        items={items}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
        value={current}
      >
        <SelectTrigger aria-label={name} size="compact">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

const controlNote = (control: KitControl) =>
  control.note ??
  (control.kind === "enum"
    ? `${control.options.length} options`
    : control.kind === "boolean"
      ? "boolean"
      : "text");

/** The playground's lower panel: a control per prop, and the JSX those values render as. */
function PlaygroundPanel({
  playgrounds,
  playground,
  args,
  onArgsChange,
  onStoryChange,
}: {
  readonly playgrounds: readonly KitPlayground[];
  readonly playground: KitPlayground;
  readonly args: KitArgs;
  readonly onArgsChange: (args: KitArgs) => void;
  readonly onStoryChange: (story: string) => void;
}) {
  const values = { ...playground.initial, ...args };
  const jsx = playground.jsx(args);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "JSX" });
  const changed = Object.entries(values).some(
    ([name, value]) => playground.initial[name] !== value,
  );
  return (
    <div className="grid h-72 shrink-0 grid-cols-5 border-t">
      <div className="col-span-3 flex min-h-0 flex-col border-e">
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="flex min-w-0 items-center gap-3">
            <span className="font-semibold text-body">Controls</span>
            {playgrounds.length > 1 ? (
              <Segmented
                label="Component"
                names={Object.fromEntries(playgrounds.map(({ name }) => [name, name]))}
                onChange={onStoryChange}
                value={playground.name}
                values={playgrounds.map(({ name }) => name)}
              />
            ) : null}
          </span>
          <Button
            disabled={!changed}
            onClick={() => onArgsChange({})}
            size="xs"
            variant="ghost-muted"
          >
            <RotateCcwIcon />
            Reset
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {Object.entries(playground.controls).map(([name, control]) => (
            <Row
              control={
                <ControlInput
                  control={control}
                  name={name}
                  onChange={(value) => onArgsChange({ ...args, [name]: value })}
                  value={values[name] ?? ""}
                />
              }
              key={name}
              line={controlNote(control)}
              size="sm"
              title={<code className="font-mono">{name}</code>}
            />
          ))}
        </div>
      </div>
      <div className="col-span-2 flex min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-4">
          <span className="font-semibold text-body">JSX</span>
          <Button onClick={() => copyToClipboard(jsx, undefined)} size="xs" variant="ghost-muted">
            {isCopied ? <CheckIcon /> : <CopyIcon />}
            {isCopied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="m-0 min-h-0 flex-1 overflow-auto bg-code p-4 font-mono text-caption text-code-foreground">
          <code>{jsx}</code>
        </pre>
      </div>
    </div>
  );
}

function UsageTab({ playground }: { readonly playground: KitPlayground }) {
  const usage = playground.usage;
  if (usage === undefined) return null;
  const column = (title: string, lines: readonly string[], good: boolean) => (
    <Section count={lines.length} title={title}>
      <Card variant="flat">
        <div className="flex flex-col p-1">
          {lines.map((line) => (
            <Row
              key={line}
              lead={
                good ? (
                  <CircleCheckIcon aria-hidden="true" className="size-4 text-status-ok" />
                ) : (
                  <CircleXIcon aria-hidden="true" className="size-4 text-status-failed" />
                )
              }
              line={line}
              lineWraps
              size="sm"
              title={good ? "Do" : "Don’t"}
            />
          ))}
        </div>
      </Card>
    </Section>
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl grid-cols-2 items-start gap-8 px-8 py-8">
        {column("Do", usage.do, true)}
        {column("Don’t", usage.dont, false)}
      </div>
    </div>
  );
}

/**
 * One component at a time: its head, then a playground (the live component, a control per prop,
 * its JSX), its variants as the section draws them, and when to use it.
 */
export function ComponentPage({
  section,
  playgrounds,
  playground,
  tab,
  args,
  onTabChange,
  onArgsChange,
  onStoryChange,
  stage,
}: {
  readonly section: KitSection;
  readonly playgrounds: readonly KitPlayground[];
  readonly playground: KitPlayground | undefined;
  readonly tab: ComponentTab;
  readonly args: KitArgs;
  readonly onTabChange: (tab: ComponentTab) => void;
  readonly onArgsChange: (args: KitArgs) => void;
  readonly onStoryChange: (story: string) => void;
  /** The canvas the playground or the variants stand on, from the shell. */
  readonly stage: (content: ReactNode) => ReactNode;
}) {
  const tabs = componentTabs(playground);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ComponentHeader
        imports={importLine(section, playground)}
        onTabChange={onTabChange}
        section={section}
        tab={tab}
        tabs={tabs}
      />
      <div className="flex min-h-0 flex-1 flex-col" id={`kit-tab-${tab}`} role="tabpanel">
        {tab === "playground" && playground !== undefined ? (
          <>
            {stage(<PlaygroundCanvas args={args} playground={playground} section={section} />)}
            <PlaygroundPanel
              args={args}
              onArgsChange={onArgsChange}
              onStoryChange={onStoryChange}
              playground={playground}
              playgrounds={playgrounds}
            />
          </>
        ) : tab === "usage" && playground !== undefined ? (
          <UsageTab playground={playground} />
        ) : (
          stage(<VariantsCanvas section={section} />)
        )}
      </div>
    </div>
  );
}

/** The live component, centred on its canvas. */
export function PlaygroundCanvas({
  section,
  playground,
  args,
}: {
  readonly section: KitSection;
  readonly playground: KitPlayground;
  readonly args: KitArgs;
}) {
  return (
    <div className="flex min-h-64 flex-1 items-center justify-center p-10">
      <SectionBoundary section={section}>{playground.render(args)}</SectionBoundary>
    </div>
  );
}

/** The section's own specimens, as it draws them. */
export function VariantsCanvas({ section }: { readonly section: KitSection }) {
  return (
    <div className="p-8">
      <SectionBoundary section={section} />
    </div>
  );
}
