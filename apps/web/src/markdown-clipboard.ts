/**
 * Converts a DOM selection inside rendered chat markdown back into markdown
 * source so highlight-and-copy keeps formatting (links, emphasis, lists,
 * fences, tables) instead of flattening to plain text. The `text/plain`
 * clipboard flavor carries the markdown; `text/html` carries a sanitized
 * copy of the rendered fragment for rich-paste targets.
 */

const SKIPPED_TAGS = new Set(["BUTTON", "INPUT", "SCRIPT", "STYLE", "TEMPLATE"]);
const SKIPPED_CLASS_NAMES = ["select-none", "sr-only"];
const SANITIZED_HTML_SELECTOR = [
  "button",
  "input",
  "script",
  "style",
  "svg",
  '[aria-hidden="true"]',
  ...SKIPPED_CLASS_NAMES.map((className) => `.${className}`),
].join(", ");

/** A task list item's state, as `ChatMarkdown` draws it: a checkbox or a mark, `data-task`. */
const LIST_ITEM_TASK = ":scope > [data-task], :scope > p > [data-task]";

interface MarkdownClipboardPayload {
  text: string;
  html: string;
}

function isSkippedElement(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName) || element.localName === "svg") return true;
  if (element.getAttribute("aria-hidden") === "true") return true;
  return SKIPPED_CLASS_NAMES.some((className) => element.classList.contains(className));
}

/** Hoists surrounding whitespace outside the markers: "` bold `" → " **bold** ". */
function wrapInlineMarker(content: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  const core = match?.[2] ?? "";
  if (!core) return content;
  return `${match?.[1] ?? ""}${marker}${core}${marker}${match?.[3] ?? ""}`;
}

/**
 * A code element whose pre wrapper fell outside the copied range is still
 * block code, recognizable by its highlighter line spans or embedded
 * newlines. Wrapping it like inline code produces backtick-surrounded
 * shell commands on paste.
 */
function isBlockCodeElement(element: Element, content: string): boolean {
  if (content.includes("\n")) return true;
  for (const child of element.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).classList.contains("line")) {
      return true;
    }
  }
  return false;
}

function wrapInlineCode(code: string): string {
  const longestRun = [...(code.match(/`+/g) ?? [])].reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(1, longestRun + (longestRun > 0 ? 1 : 0)));
  // CommonMark strips one edge space from content that has both and isn't all spaces.
  const spaceEdges = code.startsWith(" ") && code.endsWith(" ") && /[^ ]/.test(code);
  const pad = spaceEdges || code.startsWith("`") || code.endsWith("`") ? " " : "";
  return `${fence}${pad}${code}${pad}${fence}`;
}

function codeFenceFor(code: string): string {
  const longestRun = [...(code.match(/`{3,}/g) ?? [])].reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  return "`".repeat(Math.max(3, longestRun + 1));
}

function resolveCodeBlockLanguage(pre: Element): string | null {
  const declared =
    pre.closest("[data-language]")?.getAttribute("data-language") ??
    /(?:^|\s)language-(\S+)/.exec(pre.querySelector("code")?.className ?? "")?.[1] ??
    null;
  return declared && declared !== "text" ? declared : null;
}

function serializeCodeBlock(pre: Element): string {
  const code = (pre.textContent ?? "").replace(/\n$/, "");
  const fence = codeFenceFor(code);
  return `${fence}${resolveCodeBlockLanguage(pre) ?? ""}\n${code}\n${fence}\n\n`;
}

function serializeTableCell(cell: Element): string {
  return serializeChildren(cell).replace(/\n+/g, " ").trim().replaceAll("|", "\\|");
}

function tableSeparatorFor(headerCells: Element[]): string {
  const markers = headerCells.map((cell) => {
    const align = (cell as HTMLElement).style?.textAlign ?? cell.getAttribute("align") ?? "";
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    return "---";
  });
  return `| ${markers.join(" | ")} |`;
}

function serializeTable(table: Element): string {
  const rows = [...table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr")];
  if (rows.length === 0) return "";
  const lines: string[] = [];
  let emittedSeparator = false;
  for (const row of rows) {
    const cells = [...row.children].filter(
      (cell) => cell.tagName === "TH" || cell.tagName === "TD",
    );
    if (cells.length === 0) continue;
    lines.push(`| ${cells.map((cell) => serializeTableCell(cell)).join(" | ")} |`);
    if (!emittedSeparator) {
      lines.push(tableSeparatorFor(cells));
      emittedSeparator = true;
    }
  }
  return `${lines.join("\n")}\n\n`;
}

function serializeListItem(item: Element, ordered: boolean, index: number): string {
  const state = item.querySelector(LIST_ITEM_TASK)?.getAttribute("data-task");
  const task = state == null ? "" : `[${state === "done" ? "x" : " "}] `;
  const bullet = ordered ? `${index}. ` : "- ";
  const marker = `${bullet}${task}`;
  let content = serializeChildren(item)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Tight list items (no paragraph children) keep nested lists on adjacent lines.
  if (!item.querySelector(":scope > p")) {
    content = content.replace(/\n{2,}/g, "\n");
  }
  // Nested content lines up with the item text, which starts after the bullet;
  // a task box is part of that text, not of the list marker.
  const continuationIndent = " ".repeat(bullet.length);
  const [first = "", ...rest] = content.split("\n");
  return [
    `${marker}${first}`,
    ...rest.map((line) => (line.length > 0 ? `${continuationIndent}${line}` : line)),
  ].join("\n");
}

/** A list's items with the numbers an ordered list shows: from `start`, reset by each `value`. */
function numberedListItems(list: Element): { item: Element; number: number }[] {
  const start = Number.parseInt(list.getAttribute("start") ?? "1", 10);
  let next = Number.isNaN(start) ? 1 : start;
  return [...list.children]
    .filter((child) => child.tagName === "LI")
    .map((item) => {
      const value = Number.parseInt(item.getAttribute("value") ?? "", 10);
      if (!Number.isNaN(value)) next = value;
      return { item, number: next++ };
    });
}

function serializeList(list: Element, ordered: boolean): string {
  const items = numberedListItems(list);
  if (items.length === 0) return "";
  return `${items.map(({ item, number }) => serializeListItem(item, ordered, number)).join("\n")}\n\n`;
}

function serializeBlockquote(quote: Element): string {
  const content = serializeChildren(quote)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!content) return "";
  const quoted = content
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `${quoted}\n\n`;
}

function serializeDetails(details: Element): string {
  const summary =
    details.querySelector(":scope > [data-markdown-details-summary]")?.textContent?.trim() ??
    "Details";
  const contentNode = details.querySelector(":scope > * [data-markdown-details-content]");
  const content = contentNode ? serializeChildren(contentNode).trim() : "";
  const open = details.getAttribute("data-markdown-details-open") === "true" ? " open" : "";
  return `<details${open}>\n<summary>${summary}</summary>${content ? `\n\n${content}` : ""}\n</details>\n\n`;
}

function serializeAnchor(anchor: Element): string {
  const markdownCopy = anchor.getAttribute("data-markdown-copy");
  if (markdownCopy !== null) return markdownCopy;
  const content = serializeChildren(anchor);
  const href = anchor.getAttribute("href") ?? "";
  if (!/^(?:https?:\/\/|mailto:)/i.test(href)) return content;
  const label = content.trim();
  if (!label) return "";
  if (label === href) return href;
  // GFM autolinks a bare address only when it fits this shape.
  if (href === `mailto:${label}` && /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?<=[a-zA-Z])$/.test(label)) {
    return label;
  }
  return `[${label}](${href.replace(/[\\()]/g, "\\$&")})`;
}

function serializeChildren(node: Node): string {
  let out = "";
  for (const child of node.childNodes) {
    out += serializeNode(child);
  }
  return out;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    // Inter-block formatting whitespace from the renderer collapses to a
    // newline; real inline whitespace passes through untouched.
    if (text.includes("\n") && text.trim().length === 0) return "\n";
    return text;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (element.hasAttribute("data-markdown-details")) {
    return serializeDetails(element);
  }
  const markdownCopy = element.getAttribute("data-markdown-copy");
  if (markdownCopy !== null) return markdownCopy;
  if (isSkippedElement(element)) return "";

  const headingLevel = /^H([1-6])$/.exec(element.tagName)?.[1];
  if (headingLevel) {
    return `${"#".repeat(Number(headingLevel))} ${serializeChildren(element).trim()}\n\n`;
  }

  switch (element.tagName) {
    case "BR":
      return "\n";
    case "HR":
      return "---\n\n";
    case "P":
      return `${serializeChildren(element).trim()}\n\n`;
    case "PRE":
      return serializeCodeBlock(element);
    case "CODE": {
      const content = element.textContent ?? "";
      return isBlockCodeElement(element, content) ? content : wrapInlineCode(content);
    }
    case "STRONG":
    case "B":
      return wrapInlineMarker(serializeChildren(element), "**");
    case "EM":
    case "I":
      return wrapInlineMarker(serializeChildren(element), "*");
    case "DEL":
    case "S":
      return wrapInlineMarker(serializeChildren(element), "~~");
    case "A":
      return serializeAnchor(element);
    case "IMG": {
      const alt = element.getAttribute("alt") ?? "";
      const src = element.getAttribute("src") ?? "";
      return alt && src ? `![${alt}](${src})` : "";
    }
    case "UL":
      return serializeList(element, false);
    case "OL":
      return serializeList(element, true);
    case "BLOCKQUOTE":
      return serializeBlockquote(element);
    case "TABLE":
      return serializeTable(element);
    case "DIV":
    case "SECTION":
    case "ARTICLE": {
      const content = serializeChildren(element);
      return content && !content.endsWith("\n") ? `${content}\n` : content;
    }
    default:
      return serializeChildren(element);
  }
}

/** Collapses serializer spacing artifacts without touching fenced code content. */
function tidyMarkdown(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/[ \t]+(?=\n)/g, "").replace(/\n{3,}/g, "\n\n"),
    )
    .join("")
    .trim();
}

export function serializeRenderedMarkdownFragment(container: Node): string {
  return tidyMarkdown(serializeChildren(container));
}

export function serializeTableElementToMarkdown(table: Element): string {
  return serializeTable(table).trim();
}

function csvCell(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return /[",\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

export function serializeTableElementToCsv(table: Element): string {
  const rows = [...table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr")];
  const lines: string[] = [];
  for (const row of rows) {
    const cells = [...row.children].filter(
      (cell) => cell.tagName === "TH" || cell.tagName === "TD",
    );
    if (cells.length === 0) continue;
    lines.push(cells.map((cell) => csvCell(cell.textContent ?? "")).join(","));
  }
  return lines.join("\n");
}

function sanitizedHtmlFrom(container: Element): string {
  for (const node of container.querySelectorAll(SANITIZED_HTML_SELECTOR)) {
    if (
      node.classList.contains("chat-markdown-file-link") ||
      node.closest(".chat-markdown-file-link")
    ) {
      if (node.getAttribute("aria-hidden") === "true" || node.localName === "svg") {
        node.remove();
      }
      continue;
    }
    node.remove();
  }
  return `<meta charset="utf-8">${container.innerHTML}`;
}

function isList(node: Node): node is HTMLOListElement | HTMLUListElement {
  return node instanceof Element && (node.tagName === "OL" || node.tagName === "UL");
}

/**
 * The list item (or list) an endpoint sits at the very edge of: the range clones it as an empty
 * wrapper at any nesting depth, so the copy would start or end with a bare marker.
 */
function emptyListBoundary(
  ancestor: Node,
  node: Node,
  offset: number,
  side: "start" | "end",
): Element | null {
  const next = (node: Node) => (side === "start" ? node.nextSibling : node.previousSibling);
  if (node instanceof Text && offset !== (side === "start" ? node.length : 0)) return null;

  let boundary: Element | null = null;
  let remaining = node.childNodes[side === "start" ? offset : offset - 1] ?? null;
  while (node !== ancestor && node.parentNode) {
    for (let sibling = remaining; sibling; sibling = next(sibling)) {
      if (sibling instanceof Text && !sibling.data.trim()) continue;
      if (
        sibling instanceof Element &&
        isSkippedElement(sibling) &&
        !sibling.hasAttribute("data-markdown-copy") &&
        !sibling.hasAttribute("data-markdown-details")
      ) {
        continue;
      }
      return boundary;
    }
    if (node instanceof Element && node.tagName === "LI" && isList(node.parentNode)) {
      boundary = node;
    } else if (boundary && isList(node)) {
      boundary = node;
    }
    remaining = next(node);
    node = node.parentNode;
  }
  return boundary;
}

/**
 * Clones the selection and restores the markers shown for its copied list items: items copied
 * within one list clone without their list, and a list cloned from a later item would renumber
 * from its start.
 */
function cloneWithListMarkers(range: Range, container: Element): void {
  const start = emptyListBoundary(
    range.commonAncestorContainer,
    range.startContainer,
    range.startOffset,
    "start",
  );
  const end = emptyListBoundary(
    range.commonAncestorContainer,
    range.endContainer,
    range.endOffset,
    "end",
  );
  if (start || end) {
    range = range.cloneRange();
    if (start) range.setStartAfter(start);
    if (end) range.setEndBefore(end);
  }
  const ancestor = range.commonAncestorContainer;
  const withinList = isList(ancestor);
  container.appendChild(range.cloneContents());
  if (withinList) {
    const list = ancestor.cloneNode(false) as Element;
    list.append(...container.childNodes);
    container.replaceChildren(list);
  }
  // The start's ancestors below the cloned top clone as the fragment's first-child chain.
  const top = withinList ? ancestor.parentNode : ancestor;
  const chain: Node[] = [];
  for (let node: Node | null = range.startContainer; node && node !== top; node = node.parentNode) {
    chain.unshift(node);
  }
  let clone: Node | null = container;
  for (const [depth, source] of chain.entries()) {
    clone = clone?.firstChild ?? null;
    if (!(clone instanceof Element) || !(source instanceof Element)) continue;
    if (source.tagName === "LI" && clone.tagName === "LI") {
      const task = source.querySelector(LIST_ITEM_TASK);
      if (task && !clone.querySelector(LIST_ITEM_TASK)) {
        // Appended, so the first-child chain stays intact for nested items.
        clone.append(task.cloneNode(false));
      }
      continue;
    }
    if (source.tagName !== "OL") continue;
    const firstCopied = chain[depth + 1] ?? source.childNodes[range.startOffset];
    if (!firstCopied) continue;
    const shown = numberedListItems(source).find(
      ({ item }) =>
        item === firstCopied ||
        firstCopied.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const cloned = numberedListItems(clone)[0];
    if (shown && cloned && shown.number !== cloned.number) {
      clone.setAttribute("start", String(shown.number));
    }
  }
}

export function chatMarkdownClipboardPayload(
  selection: Selection,
): MarkdownClipboardPayload | null {
  const texts: string[] = [];
  const htmls: string[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (range.collapsed) continue;
    const container = document.createElement("div");
    cloneWithListMarkers(range, container);
    const ancestor = range.commonAncestorContainer;
    const ancestorElement =
      ancestor.nodeType === Node.ELEMENT_NODE ? (ancestor as Element) : ancestor.parentElement;
    if (ancestorElement?.closest("pre")) {
      const text = range.toString();
      if (text) {
        texts.push(text);
        htmls.push(sanitizedHtmlFrom(container));
      }
      continue;
    }
    const text = serializeRenderedMarkdownFragment(container);
    if (!text) continue;
    texts.push(text);
    htmls.push(sanitizedHtmlFrom(container));
  }
  if (texts.length === 0) return null;
  return { text: texts.join("\n\n"), html: htmls.join("") };
}
