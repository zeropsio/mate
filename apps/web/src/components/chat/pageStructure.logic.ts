/**
 * A page as a browser check read it without its picture, as blocks a mock of
 * the page draws: agent-browser's accessibility tree (`- role "name"
 * [attrs]`, nested by indent) read top to bottom — its headings, text,
 * links, buttons, fields, pictures, list items and code — and the containers
 * around them dropped. The mock stands where the picture would have been
 * (the owner, 2026-09-27).
 */

export type PageBlock =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "link"; readonly text: string }
  | { readonly kind: "button"; readonly text: string }
  | { readonly kind: "field"; readonly text: string }
  | { readonly kind: "image"; readonly text: string }
  | { readonly kind: "item"; readonly text: string }
  | { readonly kind: "code"; readonly text: string };

interface TreeNode {
  readonly role: string;
  readonly name: string | null;
  readonly attrs: string;
  readonly value: string | null;
  readonly children: TreeNode[];
}

/** `  - heading "Status" [level=1, ref=e1]` · `- text: Hostname` · `- StaticText "Hi"`. */
const LINE = /^(\s*)- ([A-Za-z][\w-]*)(?: "((?:[^"\\]|\\.)*)")?(?: \[([^\]]*)\])?:?\s*(.*)$/;

function unquote(value: string): string {
  return value.replace(/\\(["\\])/g, "$1");
}

function parseTree(tree: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: Array<{ readonly indent: number; readonly node: TreeNode }> = [];
  for (const line of tree.split("\n")) {
    const match = LINE.exec(line);
    if (match === null) continue;
    const [, space = "", role = "", name, attrs = "", rest = ""] = match;
    const node: TreeNode = {
      role,
      name: name === undefined ? null : unquote(name),
      attrs,
      value: rest.trim().length > 0 ? rest.trim().replace(/^"(.*)"$/, "$1") : null,
      children: [],
    };
    const indent = space.length;
    while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1);
    if (parent === undefined) roots.push(node);
    else parent.node.children.push(node);
    stack.push({ indent, node });
  }
  return roots;
}

/** Everything a node says, its own words and its children's. */
function textOf(node: TreeNode): string {
  if (node.role === "StaticText" || node.role === "text") return node.name ?? node.value ?? "";
  const own = node.children.map(textOf).join("");
  return own.length > 0 ? own : (node.name ?? node.value ?? "");
}

const clean = (text: string, limit = 160) => {
  const said = text.replace(/\s+/g, " ").trim();
  return said.length > limit ? `${said.slice(0, limit - 1)}…` : said;
};

const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"]);
const IMAGE_ROLES = new Set(["img", "image", "figure"]);

/** The blocks a tree's page reads as, top to bottom, at most `limit` of them. */
export function pageBlocks(tree: string, limit = 80): PageBlock[] {
  const blocks: PageBlock[] = [];
  const add = (block: PageBlock) => {
    if (blocks.length >= limit) return;
    if ("text" in block && block.text.length === 0) return;
    blocks.push(block);
  };
  const walk = (node: TreeNode) => {
    if (blocks.length >= limit) return;
    const { role } = node;
    if (role === "heading") {
      const level = Number(/level=(\d)/.exec(node.attrs)?.[1] ?? 2);
      add({ kind: "heading", level, text: clean(node.name ?? textOf(node)) });
      return;
    }
    if (role === "paragraph") {
      add({ kind: "text", text: clean(textOf(node), 320) });
      return;
    }
    if (role === "link") {
      add({ kind: "link", text: clean(node.name ?? textOf(node), 80) });
      return;
    }
    if (role === "button") {
      add({ kind: "button", text: clean(node.name ?? textOf(node), 40) });
      return;
    }
    if (FIELD_ROLES.has(role)) {
      add({ kind: "field", text: clean(node.name ?? node.value ?? "", 60) });
      return;
    }
    if (IMAGE_ROLES.has(role)) {
      add({ kind: "image", text: clean(node.name ?? "", 60) });
      return;
    }
    if (role === "listitem") {
      add({ kind: "item", text: clean(textOf(node)) });
      return;
    }
    if (role === "code") {
      add({ kind: "code", text: clean(textOf(node), 120) });
      return;
    }
    if (role === "StaticText" || role === "text") {
      add({ kind: "text", text: clean(node.name ?? node.value ?? "", 320) });
      return;
    }
    // A container: what it holds, in order — its words said in pieces
    // ("Nova", " ", "is working") read as one line.
    let line: string[] = [];
    const endLine = () => {
      add({ kind: "text", text: clean(line.join(" "), 320) });
      line = [];
    };
    for (const child of node.children) {
      if (child.role === "StaticText" || child.role === "text") {
        line.push(child.name ?? child.value ?? "");
        continue;
      }
      endLine();
      walk(child);
    }
    endLine();
  };
  for (const root of parseTree(tree)) walk(root);
  return blocks;
}

/** A page's text, read with no tree: its lines as paragraphs. */
export function textBlocks(text: string, limit = 80): PageBlock[] {
  return text
    .split(/\n+/)
    .map((line) => clean(line, 320))
    .filter((line) => line.length > 0)
    .slice(0, limit)
    .map((line) => ({ kind: "text", text: line }));
}
