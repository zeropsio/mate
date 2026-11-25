import type { ReactNode } from "react";

/**
 * One prop a playground lets the person set. An `enum` is a choice among its options (a segmented
 * toggle up to four, a select past that), a `boolean` a switch, `text` a field.
 */
export type KitControl =
  | { readonly kind: "enum"; readonly options: readonly string[]; readonly note?: string }
  | { readonly kind: "boolean"; readonly note?: string }
  | { readonly kind: "text"; readonly note?: string };

export type KitArgValue = string | boolean;
export type KitArgs = Readonly<Record<string, KitArgValue>>;

type ArgOf<Control> = Control extends {
  readonly kind: "enum";
  readonly options: readonly (infer O)[];
}
  ? O
  : Control extends { readonly kind: "boolean" }
    ? boolean
    : string;

/** The arguments a playground's controls produce, typed from the controls themselves. */
export type ArgsOf<Controls extends Readonly<Record<string, KitControl>>> = {
  readonly [Name in keyof Controls]: ArgOf<Controls[Name]>;
};

/** A component page's Usage tab: when to reach for it, and when not to. */
export interface KitUsage {
  readonly do: readonly string[];
  readonly dont: readonly string[];
}

/**
 * A section's playground: the live component, its controls and the JSX it renders as. A file in
 * `kit/playground/` named after its section's id default-exports one; the registry finds it.
 */
export interface KitPlayground {
  /** The section it belongs to, by id: the file's own name, unless the section has several. */
  readonly section: string;
  /** The component it plays, as its JSX names it: a section with several offers a choice. */
  readonly name: string;
  /** The import line the JSX needs. */
  readonly imports: string;
  readonly controls: Readonly<Record<string, KitControl>>;
  readonly initial: KitArgs;
  /** Draws the component; any argument it was not given, or does not know, takes its initial. */
  readonly render: (args: KitArgs) => ReactNode;
  readonly jsx: (args: KitArgs) => string;
  readonly usage?: KitUsage;
}

/** Reads each control's argument from what the address gave, falling back to its initial. */
function decodeArgs<Controls extends Readonly<Record<string, KitControl>>>(
  controls: Controls,
  initial: ArgsOf<Controls>,
  given: KitArgs,
): ArgsOf<Controls> {
  const decoded: Record<string, KitArgValue> = {};
  for (const [name, control] of Object.entries(controls)) {
    const value = given[name];
    const fallback = initial[name as keyof Controls] as KitArgValue;
    decoded[name] =
      control.kind === "enum"
        ? typeof value === "string" && control.options.includes(value)
          ? value
          : fallback
        : control.kind === "boolean"
          ? typeof value === "boolean"
            ? value
            : fallback
          : typeof value === "string"
            ? value
            : fallback;
  }
  return decoded as ArgsOf<Controls>;
}

export function definePlayground<
  const Controls extends Readonly<Record<string, KitControl>>,
>(playground: {
  readonly section: string;
  readonly name: string;
  readonly imports: string;
  readonly controls: Controls;
  readonly initial: ArgsOf<Controls>;
  readonly render: (args: ArgsOf<Controls>) => ReactNode;
  readonly jsx: (args: ArgsOf<Controls>) => string;
  readonly usage?: KitUsage;
}): KitPlayground {
  const read = (given: KitArgs) => decodeArgs(playground.controls, playground.initial, given);
  return {
    section: playground.section,
    name: playground.name,
    imports: playground.imports,
    controls: playground.controls,
    initial: playground.initial,
    render: (given) => playground.render(read(given)),
    jsx: (given) => playground.jsx(read(given)),
    ...(playground.usage === undefined ? {} : { usage: playground.usage }),
  };
}

/** A prop JSX writes in braces: a handler, a variable, an element (`open={open}`). */
export interface JsxCode {
  readonly code: string;
}

export const jsxCode = (code: string): JsxCode => ({ code });

/**
 * A prop's value as JSX source carries it: a number (`size={64}`) and code are written in braces.
 */
type JsxValue = KitArgValue | number | JsxCode;

/** A prop as JSX writes it, or nothing when it is the component's default. */
function jsxProp(name: string, value: JsxValue | undefined, fallback?: JsxValue): string[] {
  if (value === undefined || value === fallback) return [];
  if (typeof value === "object") return [`${name}={${value.code}}`];
  if (value === true) return [name];
  if (value === false) return [`${name}={false}`];
  if (typeof value === "number") return [`${name}={${value}}`];
  return [`${name}="${value}"`];
}

/**
 * One JSX element as source writes it: its props (each left out while it is the component's
 * default), on one line while short, one per line past that, and its children indented.
 */
export function jsxElement(
  tag: string,
  props: Readonly<Record<string, JsxValue | undefined>>,
  children?: string,
  defaults: Readonly<Record<string, JsxValue>> = {},
): string {
  const parts = Object.entries(props).flatMap(([name, value]) =>
    jsxProp(name, value, defaults[name]),
  );
  const inline = parts.length === 0 ? tag : `${tag} ${parts.join(" ")}`;
  const open =
    inline.length > 64 ? `${tag}\n${parts.map((part) => `  ${part}`).join("\n")}\n` : inline;
  if (children === undefined || children === "") return `<${open} />`;
  const body =
    children.includes("\n") || children.startsWith("<") || open.includes("\n")
      ? `\n${children
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}\n`
      : children;
  return `<${open}>${body}</${tag}>`;
}

/** Arguments that differ from the playground's initial ones, as the address carries them. */
export function encodeKitArgs(args: KitArgs, initial: KitArgs): string | undefined {
  const parts = Object.entries(args).flatMap(([name, value]) =>
    value === initial[name]
      ? []
      : [`${name}:${typeof value === "boolean" ? `!${value}` : encodeURIComponent(value)}`],
  );
  return parts.length === 0 ? undefined : parts.join(";");
}

export function decodeKitArgs(encoded: string | undefined): KitArgs {
  if (encoded === undefined) return {};
  const args: Record<string, KitArgValue> = {};
  for (const part of encoded.split(";")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const name = part.slice(0, colon);
    const raw = part.slice(colon + 1);
    if (raw === "!true" || raw === "!false") {
      args[name] = raw === "!true";
      continue;
    }
    try {
      args[name] = decodeURIComponent(raw);
    } catch {
      args[name] = raw;
    }
  }
  return args;
}
