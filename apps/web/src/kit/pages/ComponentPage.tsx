import { CheckIcon, CircleCheckIcon, CircleXIcon, CopyIcon, RotateCcwIcon } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
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
import { Tab } from "~/components/ui/tab-strip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import type { KitArgs, KitControl, KitPlayground } from "../kitPlayground";
import type { KitGroup, KitSection } from "../kitSection";
import { Segmented } from "../shell/Segmented";
import { jsxTokens, type JsxTokenKind } from "./jsxTokens";
import { SectionBoundary } from "./SectionBoundary";

export const COMPONENT_TABS = ["playground", "variants", "usage"] as const;
export type ComponentTab = (typeof COMPONENT_TABS)[number];

const TAB_LABEL: Readonly<Record<ComponentTab, string>> = {
  playground: "Playground",
  variants: "Variants",
  usage: "Usage",
};

const STATUS: Readonly<Record<KitGroup, { tone: "success" | "neutral"; label: string }>> = {
  Chosen: { tone: "success", label: "Chosen" },
  Kit: { tone: "neutral", label: "Kit" },
};

/** Each piece of the JSX in an ink that adapts per appearance: tags blue, values green, code amber. */
const TOKEN_CLASS: Readonly<Record<JsxTokenKind, string>> = {
  punctuation: "text-muted-foreground",
  tag: "text-info-foreground",
  attribute: "text-code-foreground",
  string: "text-success-foreground",
  expression: "text-warning-foreground",
  text: "text-code-foreground",
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

/** A quiet press that copies a line of code: what it shows, and the whole line in its tooltip. */
function CopyChip({
  target,
  value,
  children,
}: {
  /** What is copied, in a few words: "the source path". */
  readonly target: string;
  readonly value: string;
  readonly children: ReactNode;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={isCopied ? "Copied" : `Copy ${target}`}
            onClick={() => copyToClipboard(value, undefined)}
            size="xs"
            variant="ghost-muted"
          />
        }
      >
        {isCopied ? <CheckIcon /> : <CopyIcon />}
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span className="font-mono">{value}</span>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * A component's head, one compact band: its name with its status and kind beside it, where it
 * lives and how to import it, its purpose under them, and its views at the band's end.
 */
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
  const file = section.source.slice(section.source.lastIndexOf("/") + 1);
  return (
    <header className="flex shrink-0 flex-col gap-1 border-b px-6 pt-5 pb-4">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-8 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="m-0 truncate font-semibold text-foreground text-title">{section.title}</h1>
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone="neutral">{section.kind}</Badge>
          <span className="ms-2 flex min-w-0 items-center gap-0.5">
            <CopyChip target="the source path" value={section.source}>
              <span className="truncate font-mono">{file}</span>
            </CopyChip>
            {imports === undefined ? null : (
              <CopyChip target="the import" value={imports}>
                <span className="font-mono">import</span>
              </CopyChip>
            )}
          </span>
        </div>
        <div
          aria-label={`${section.title} views`}
          className="flex shrink-0 items-center gap-1"
          onKeyDown={onKeyDown}
          ref={list}
          role="tablist"
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
        </div>
      </div>
      <p className="m-0 max-w-4xl text-body text-muted-foreground">{section.purpose}</p>
    </header>
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
      <Input
        aria-label={name}
        onChange={(event) => onChange(event.currentTarget.value)}
        size="sm"
        value={typeof value === "string" ? value : ""}
      />
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
    <Select
      items={items}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      value={current}
    >
      <SelectTrigger aria-label={name} size="sm">
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
  );
}

const controlNote = (control: KitControl) =>
  control.note ??
  (control.kind === "enum"
    ? `${control.options.length} options`
    : control.kind === "boolean"
      ? "On or off"
      : "Any text");

/** The JSX, each piece in its tint. */
function CodeBlock({ code }: { readonly code: string }) {
  return (
    <pre className="m-0 min-h-0 flex-1 overflow-auto bg-code px-4 py-3 font-mono text-caption text-code-foreground">
      <code>
        {jsxTokens(code).map((token, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- pieces have no identity but their place
          <span className={TOKEN_CLASS[token.kind]} key={index}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

/** A panel's heading line: its name, then its tools. */
function PanelHead({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b ps-4 pe-2">
      <h2 className="m-0 font-medium text-body text-foreground">{title}</h2>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}

/**
 * The playground's panel: a control per prop, and the JSX those values render as. Beside the
 * canvas on a wide page, the code under the controls; under the canvas on a narrow one, the code
 * beside them.
 */
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
    <aside
      aria-label="Controls and code"
      className="flex h-80 shrink-0 border-t bg-background @6xl:h-auto @6xl:w-96 @6xl:flex-col @6xl:border-t-0 @6xl:border-s"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PanelHead title="Controls">
          <Button
            disabled={!changed}
            onClick={() => onArgsChange({})}
            size="xs"
            variant="ghost-muted"
          >
            <RotateCcwIcon />
            Reset
          </Button>
        </PanelHead>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {playgrounds.length > 1 ? (
            <div className="flex flex-col gap-2">
              <span className="font-mono text-caption text-muted-foreground">component</span>
              <Segmented
                label="Component"
                names={Object.fromEntries(playgrounds.map(({ name }) => [name, name]))}
                onChange={onStoryChange}
                value={playground.name}
                values={playgrounds.map(({ name }) => name)}
              />
            </div>
          ) : null}
          {Object.entries(playground.controls).map(([name, control]) => (
            <div className="flex flex-col items-start gap-2" key={name}>
              <div className="flex flex-col gap-0.5">
                <code className="font-mono text-caption text-foreground">{name}</code>
                <span className="text-caption text-muted-foreground">{controlNote(control)}</span>
              </div>
              <div
                className={
                  control.kind === "enum" && control.options.length <= 4 ? "" : "w-full max-w-80"
                }
              >
                <ControlInput
                  control={control}
                  name={name}
                  onChange={(value) => onArgsChange({ ...args, [name]: value })}
                  value={values[name] ?? ""}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 w-2/5 flex-col border-s @6xl:max-h-2/5 @6xl:min-h-40 @6xl:w-auto @6xl:shrink-0 @6xl:border-s-0 @6xl:border-t">
        <PanelHead title="Code">
          <Button onClick={() => copyToClipboard(jsx, undefined)} size="xs" variant="ghost-muted">
            {isCopied ? <CheckIcon /> : <CopyIcon />}
            {isCopied ? "Copied" : "Copy"}
          </Button>
        </PanelHead>
        <CodeBlock code={jsx} />
      </div>
    </aside>
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
      <div className="grid max-w-6xl grid-cols-1 items-start gap-8 px-6 py-8 @5xl:grid-cols-2">
        {column("Do", usage.do, true)}
        {column("Don’t", usage.dont, false)}
      </div>
    </div>
  );
}

/**
 * One component at a time: its head, then a playground (the live component on a canvas that fills
 * the page, a control per prop and its JSX beside it), its variants as the section draws them, and
 * when to use it.
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
    <div className="@container flex min-h-0 flex-1 flex-col">
      <ComponentHeader
        imports={importLine(section, playground)}
        onTabChange={onTabChange}
        section={section}
        tab={tab}
        tabs={tabs}
      />
      {tab === "playground" && playground !== undefined ? (
        <div
          className="flex min-h-0 flex-1 flex-col @6xl:flex-row"
          id="kit-tab-playground"
          role="tabpanel"
        >
          {stage(<PlaygroundCanvas args={args} playground={playground} section={section} />)}
          <PlaygroundPanel
            args={args}
            onArgsChange={onArgsChange}
            onStoryChange={onStoryChange}
            playground={playground}
            playgrounds={playgrounds}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col" id={`kit-tab-${tab}`} role="tabpanel">
          {tab === "usage" && playground !== undefined ? (
            <UsageTab playground={playground} />
          ) : (
            stage(<VariantsCanvas section={section} />)
          )}
        </div>
      )}
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
    <div className="flex min-h-48 flex-1 items-center justify-center p-10">
      <SectionBoundary section={section}>{playground.render(args)}</SectionBoundary>
    </div>
  );
}

/** The section's own specimens, as it draws them, across the canvas's whole width. */
export function VariantsCanvas({ section }: { readonly section: KitSection }) {
  return (
    <div className="px-8 py-8">
      <SectionBoundary section={section} />
    </div>
  );
}
