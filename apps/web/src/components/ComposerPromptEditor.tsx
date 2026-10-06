import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { type ServerProviderSkill } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import {
  $applyNodeReplacement,
  $createRangeSelectionFromDom,
  $createRangeSelection,
  $getSelection,
  $setSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COPY_COMMAND,
  CUT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  PASTE_COMMAND,
  BLUR_COMMAND,
  DRAGEND_COMMAND,
  DRAGSTART_COMMAND,
  DROP_COMMAND,
  FOCUS_COMMAND,
  $getRoot,
  HISTORY_MERGE_TAG,
  DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
  type SerializedLexicalNode,
  type EditorState,
  type NodeKey,
  type Spread,
} from "lexical";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from "~/composer-logic";
import {
  selectionTouchesMentionBoundary,
  splitPromptIntoEditorSegments,
} from "~/composer-editor-mentions";
import { INLINE_PICTURE_PLACEHOLDER } from "~/lib/composerPictures";
import { INLINE_FILE_PLACEHOLDER } from "~/lib/composerFiles";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "~/lib/terminalContext";
import { cn, isMacPlatform } from "~/lib/utils";
import { basenameOfPath } from "~/pierre-icons";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
  SKILL_CHIP_ICON_SVG,
} from "./composerInlineChip";
import {
  ComposerPicture,
  ComposerPicturesContext,
  type ComposerPicturesValue,
  type ComposerPictureView,
} from "./chat/ComposerPicture";
import {
  ComposerFile,
  ComposerFilesContext,
  type ComposerFilesValue,
  type ComposerFileView,
} from "./chat/ComposerFile";
import { FILE_TAG_CHIP_CLASS_NAME, FileTagChipContent } from "./chat/FileTagChip";
import { ComposerPendingTerminalContextChip } from "./chat/ComposerPendingTerminalContexts";
import { formatProviderSkillDisplayName } from "@t3tools/client-runtime/providerSkills";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { registerComposerInlineTokenPaste } from "./composerInlineTokenPaste";
import { MateFace } from "./zerops/primitives";

const COMPOSER_EDITOR_HMR_KEY = `composer-editor-${Math.random().toString(36).slice(2)}`;
const SURROUND_SYMBOLS: [string, string][] = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["'", "'"],
  ['"', '"'],
  ["“", "”"],
  ["`", "`"],
  ["<", ">"],
  ["«", "»"],
  ["*", "*"],
  ["_", "_"],
];
const SURROUND_SYMBOLS_MAP = new Map<string, string>(SURROUND_SYMBOLS);
const BACKTICK_SURROUND_CLOSE_SYMBOL = SURROUND_SYMBOLS_MAP.get("`") ?? null;

type SerializedComposerMentionNode = Spread<
  {
    path: string;
    source?: string;
    type: "composer-mention";
    version: 1;
  },
  SerializedLexicalNode
>;

type SerializedComposerCrewmateNode = Spread<
  {
    handle: string;
    tint: MateTintId;
    type: "composer-crewmate";
    version: 1;
  },
  SerializedLexicalNode
>;

type SerializedComposerSkillNode = Spread<
  {
    skillName: string;
    skillLabel?: string;
    skillDescription?: string;
    type: "composer-skill";
    version: 1;
  },
  SerializedLexicalNode
>;

type SerializedComposerTerminalContextNode = Spread<
  {
    context: TerminalContextDraft;
    type: "composer-terminal-context";
    version: 1;
  },
  SerializedLexicalNode
>;

type SerializedComposerPictureNode = Spread<
  {
    imageId: string;
    type: "composer-picture";
    version: 1;
  },
  SerializedLexicalNode
>;

type SerializedComposerFileNode = Spread<
  {
    fileId: string;
    type: "composer-file";
    version: 1;
  },
  SerializedLexicalNode
>;

const ComposerTerminalContextActionsContext = createContext<{
  onRemoveTerminalContext: (contextId: string) => void;
}>({
  onRemoveTerminalContext: () => {},
});

function ComposerMentionDecorator(props: { path: string }) {
  const theme = resolvedThemeFromDocument();
  const chip = (
    <span
      className={FILE_TAG_CHIP_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-mention-chip="true"
    >
      <FileTagChipContent path={props.path} label={basenameOfPath(props.path)} theme={theme} />
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-120 whitespace-normal leading-tight wrap-anywhere">
        {props.path}
      </TooltipPopup>
    </Tooltip>
  );
}

class ComposerMentionNode extends DecoratorNode<React.ReactElement> {
  __path: string;
  __source: string;

  static override getType(): string {
    return "composer-mention";
  }

  static override clone(node: ComposerMentionNode): ComposerMentionNode {
    return new ComposerMentionNode(node.__path, node.__source, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerMentionNode): ComposerMentionNode {
    return $createComposerMentionNode(serializedNode.path, serializedNode.source).updateFromJSON(
      serializedNode,
    );
  }

  constructor(path: string, source = serializeComposerFileLink(path), key?: NodeKey) {
    super(key);
    this.__path = path;
    this.__source = source;
  }

  override exportJSON(): SerializedComposerMentionNode {
    return {
      ...super.exportJSON(),
      path: this.__path,
      source: this.__source,
      type: "composer-mention",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME;
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return this.__source;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): React.ReactElement {
    return <ComposerMentionDecorator path={this.__path} />;
  }
}

function $createComposerMentionNode(path: string, source?: string): ComposerMentionNode {
  return $applyNodeReplacement(new ComposerMentionNode(path, source));
}

/**
 * The prompt's type: the composer's font and size, 16 px on a phone so it
 * never zooms. `ComposerRoomHeld` lays a held draft out in it too.
 */
export const COMPOSER_PROMPT_TYPE_CLASS_NAME =
  "relative [font-family:var(--font-composer,var(--font-sans))] [font-size:var(--font-size-prompt,0.875rem)] [@media(max-width:39.999rem)_and_(pointer:coarse)]:[font-size:max(var(--font-size-prompt,1rem),16px)]";

/** A crewmate the composer offers (the lead's chat), as the lead writes to it: `@handle`. */
export interface ComposerCrewmateChip {
  readonly handle: string;
  readonly tint: MateTintId;
}

function ComposerCrewmateDecorator(props: ComposerCrewmateChip) {
  return (
    <span
      className={COMPOSER_INLINE_CHIP_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-crewmate-chip={props.handle}
    >
      <MateFace size="dot" state="idle" tint={props.tint} />
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>@{props.handle}</span>
    </span>
  );
}

/** A crewmate's `@handle`: drawn as the crewmate, written as `@handle`. */
class ComposerCrewmateNode extends DecoratorNode<React.ReactElement> {
  __handle: string;
  __tint: MateTintId;

  static override getType(): string {
    return "composer-crewmate";
  }

  static override clone(node: ComposerCrewmateNode): ComposerCrewmateNode {
    return new ComposerCrewmateNode(node.__handle, node.__tint, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerCrewmateNode): ComposerCrewmateNode {
    return $createComposerCrewmateNode(serializedNode.handle, serializedNode.tint).updateFromJSON(
      serializedNode,
    );
  }

  constructor(handle: string, tint: MateTintId, key?: NodeKey) {
    super(key);
    this.__handle = handle;
    this.__tint = tint;
  }

  override exportJSON(): SerializedComposerCrewmateNode {
    return {
      ...super.exportJSON(),
      handle: this.__handle,
      tint: this.__tint,
      type: "composer-crewmate",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME;
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return `@${this.__handle}`;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): React.ReactElement {
    return <ComposerCrewmateDecorator handle={this.__handle} tint={this.__tint} />;
  }
}

function $createComposerCrewmateNode(handle: string, tint: MateTintId): ComposerCrewmateNode {
  return $applyNodeReplacement(new ComposerCrewmateNode(handle, tint));
}

function resolveSkillDescription(
  skill: Pick<ServerProviderSkill, "shortDescription" | "description">,
): string | null {
  const shortDescription = skill.shortDescription?.trim();
  if (shortDescription) {
    return shortDescription;
  }
  const description = skill.description?.trim();
  return description || null;
}

type ComposerSkillMetadata = {
  label: string;
  description: string | null;
};

function skillMetadataByName(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyMap<string, ComposerSkillMetadata> {
  return new Map(
    skills.map((skill) => [
      skill.name,
      {
        label: formatProviderSkillDisplayName(skill),
        description: resolveSkillDescription(skill),
      },
    ]),
  );
}

function ComposerSkillDecorator(props: { skillLabel: string; skillDescription: string | null }) {
  const chip = (
    <span
      className={COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-skill-chip="true"
    >
      <span
        aria-hidden="true"
        className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
        dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
      />
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.skillLabel}</span>
    </span>
  );

  if (!props.skillDescription) {
    return chip;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-120 whitespace-normal leading-tight">
        {props.skillDescription}
      </TooltipPopup>
    </Tooltip>
  );
}

class ComposerSkillNode extends DecoratorNode<React.ReactElement> {
  __skillName: string;
  __skillLabel: string;
  __skillDescription: string | null;

  static override getType(): string {
    return "composer-skill";
  }

  static override clone(node: ComposerSkillNode): ComposerSkillNode {
    return new ComposerSkillNode(
      node.__skillName,
      node.__skillLabel,
      node.__skillDescription,
      node.__key,
    );
  }

  static override importJSON(serializedNode: SerializedComposerSkillNode): ComposerSkillNode {
    return $createComposerSkillNode(
      serializedNode.skillName,
      serializedNode.skillLabel ?? serializedNode.skillName,
      serializedNode.skillDescription ?? null,
    ).updateFromJSON(serializedNode);
  }

  constructor(
    skillName: string,
    skillLabel: string,
    skillDescription: string | null,
    key?: NodeKey,
  ) {
    super(key);
    const normalizedSkillName = skillName.startsWith("$") ? skillName.slice(1) : skillName;
    this.__skillName = normalizedSkillName;
    this.__skillLabel = skillLabel;
    this.__skillDescription = skillDescription;
  }

  override exportJSON(): SerializedComposerSkillNode {
    return {
      ...super.exportJSON(),
      skillName: this.__skillName,
      skillLabel: this.__skillLabel,
      ...(this.__skillDescription ? { skillDescription: this.__skillDescription } : {}),
      type: "composer-skill",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME;
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return `$${this.__skillName}`;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): React.ReactElement {
    return (
      <ComposerSkillDecorator
        skillLabel={this.__skillLabel}
        skillDescription={this.__skillDescription}
      />
    );
  }
}

function $createComposerSkillNode(
  skillName: string,
  skillLabel: string,
  skillDescription: string | null,
): ComposerSkillNode {
  return $applyNodeReplacement(new ComposerSkillNode(skillName, skillLabel, skillDescription));
}

function ComposerTerminalContextDecorator(props: { context: TerminalContextDraft }) {
  return <ComposerPendingTerminalContextChip context={props.context} />;
}

class ComposerTerminalContextNode extends DecoratorNode<React.ReactElement> {
  __context: TerminalContextDraft;

  static override getType(): string {
    return "composer-terminal-context";
  }

  static override clone(node: ComposerTerminalContextNode): ComposerTerminalContextNode {
    return new ComposerTerminalContextNode(node.__context, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedComposerTerminalContextNode,
  ): ComposerTerminalContextNode {
    return $createComposerTerminalContextNode(serializedNode.context);
  }

  constructor(context: TerminalContextDraft, key?: NodeKey) {
    super(key);
    this.__context = context;
  }

  override exportJSON(): SerializedComposerTerminalContextNode {
    return {
      ...super.exportJSON(),
      context: this.__context,
      type: "composer-terminal-context",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME;
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return INLINE_TERMINAL_CONTEXT_PLACEHOLDER;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): React.ReactElement {
    return <ComposerTerminalContextDecorator context={this.__context} />;
  }
}

function $createComposerTerminalContextNode(
  context: TerminalContextDraft,
): ComposerTerminalContextNode {
  return $applyNodeReplacement(new ComposerTerminalContextNode(context));
}

/**
 * A picture's place in the text: it holds the picture's id, is written as the
 * picture placeholder, and draws what the composer says about the picture. Its
 * slot sits on a row of its own, beside the pictures and files written right
 * next to it, so words sit above and below them.
 */
class ComposerPictureNode extends DecoratorNode<React.ReactElement> {
  __imageId: string;

  static override getType(): string {
    return "composer-picture";
  }

  static override clone(node: ComposerPictureNode): ComposerPictureNode {
    return new ComposerPictureNode(node.__imageId, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerPictureNode): ComposerPictureNode {
    return $createComposerPictureNode(serializedNode.imageId).updateFromJSON(serializedNode);
  }

  constructor(imageId: string, key?: NodeKey) {
    super(key);
    this.__imageId = imageId;
  }

  override exportJSON(): SerializedComposerPictureNode {
    return {
      ...super.exportJSON(),
      imageId: this.__imageId,
      type: "composer-picture",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "composer-picture-slot composer-attachment-slot";
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return INLINE_PICTURE_PLACEHOLDER;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): React.ReactElement {
    return <ComposerPicture id={this.__imageId} />;
  }
}

function $createComposerPictureNode(imageId: string): ComposerPictureNode {
  return $applyNodeReplacement(new ComposerPictureNode(imageId));
}

/**
 * A file's place in the text: it holds the file's id, is written as the file
 * placeholder, and draws the file's chip. Its slot carries the class every
 * attachment's slot does, so a run of them can share a row.
 */
class ComposerFileNode extends DecoratorNode<React.ReactElement> {
  __fileId: string;

  static override getType(): string {
    return "composer-file";
  }

  static override clone(node: ComposerFileNode): ComposerFileNode {
    return new ComposerFileNode(node.__fileId, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerFileNode): ComposerFileNode {
    return $createComposerFileNode(serializedNode.fileId).updateFromJSON(serializedNode);
  }

  constructor(fileId: string, key?: NodeKey) {
    super(key);
    this.__fileId = fileId;
  }

  override exportJSON(): SerializedComposerFileNode {
    return {
      ...super.exportJSON(),
      fileId: this.__fileId,
      type: "composer-file",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "composer-file-slot composer-attachment-slot";
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return INLINE_FILE_PLACEHOLDER;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): React.ReactElement {
    return <ComposerFile id={this.__fileId} />;
  }
}

function $createComposerFileNode(fileId: string): ComposerFileNode {
  return $applyNodeReplacement(new ComposerFileNode(fileId));
}

type ComposerInlineTokenNode =
  | ComposerMentionNode
  | ComposerCrewmateNode
  | ComposerSkillNode
  | ComposerTerminalContextNode
  | ComposerPictureNode
  | ComposerFileNode;

function isComposerInlineTokenNode(candidate: unknown): candidate is ComposerInlineTokenNode {
  return (
    candidate instanceof ComposerMentionNode ||
    candidate instanceof ComposerCrewmateNode ||
    candidate instanceof ComposerSkillNode ||
    candidate instanceof ComposerTerminalContextNode ||
    candidate instanceof ComposerPictureNode ||
    candidate instanceof ComposerFileNode
  );
}

function resolvedThemeFromDocument(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function terminalContextSignature(contexts: ReadonlyArray<TerminalContextDraft>): string {
  return contexts
    .map((context) =>
      [
        context.id,
        context.threadId,
        context.terminalId,
        context.terminalLabel,
        context.lineStart,
        context.lineEnd,
        context.createdAt,
        context.text,
      ].join("\u001f"),
    )
    .join("\u001e");
}

const NO_CREWMATES: ReadonlyArray<ComposerCrewmateChip> = [];
const NO_PICTURES: ReadonlyArray<ComposerPictureView> = [];
const IGNORE_PICTURE = () => {};
const NO_FILE_VIEWS: ReadonlyArray<ComposerFileView> = [];
const PLACE_NO_PICTURES = (ids: ReadonlyArray<string>): ReadonlyArray<string | null> =>
  ids.map(() => null);

function crewmateSignature(crewmates: ReadonlyArray<ComposerCrewmateChip>): string {
  return crewmates.map((mate) => `${mate.handle}:${mate.tint}`).join("\u001f");
}

function skillSignature(skills: ReadonlyArray<ServerProviderSkill>): string {
  return skills
    .map((skill) =>
      [
        skill.name,
        skill.displayName ?? "",
        skill.shortDescription ?? "",
        skill.description ?? "",
        skill.path,
        skill.scope ?? "",
        skill.enabled ? "1" : "0",
      ].join("\u001f"),
    )
    .join("\u001e");
}

function clampExpandedCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length;
  return Math.max(0, Math.min(value.length, Math.floor(cursor)));
}

function getComposerInlineTokenTextLength(_node: ComposerInlineTokenNode): 1 {
  return 1;
}

function getComposerInlineTokenExpandedTextLength(node: ComposerInlineTokenNode): number {
  return node.getTextContentSize();
}

function getAbsoluteOffsetForInlineTokenPoint(
  node: ComposerInlineTokenNode,
  absoluteOffset: number,
  pointOffset: number,
): number {
  return absoluteOffset + (pointOffset > 0 ? getComposerInlineTokenTextLength(node) : 0);
}

function getExpandedAbsoluteOffsetForInlineTokenPoint(
  node: ComposerInlineTokenNode,
  absoluteOffset: number,
  pointOffset: number,
): number {
  return absoluteOffset + (pointOffset > 0 ? getComposerInlineTokenExpandedTextLength(node) : 0);
}

function findSelectionPointForInlineToken(
  node: ComposerInlineTokenNode,
  remainingRef: { value: number },
): { key: string; offset: number; type: "element" } | null {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return null;
  const index = node.getIndexWithinParent();
  if (remainingRef.value === 0) {
    return {
      key: parent.getKey(),
      offset: index,
      type: "element",
    };
  }
  if (remainingRef.value === getComposerInlineTokenTextLength(node)) {
    return {
      key: parent.getKey(),
      offset: index + 1,
      type: "element",
    };
  }
  remainingRef.value -= getComposerInlineTokenTextLength(node);
  return null;
}

function getComposerNodeTextLength(node: LexicalNode): number {
  if (isComposerInlineTokenNode(node)) {
    return getComposerInlineTokenTextLength(node);
  }
  if ($isTextNode(node)) {
    return node.getTextContentSize();
  }
  if ($isLineBreakNode(node)) {
    return 1;
  }
  if ($isElementNode(node)) {
    return node.getChildren().reduce((total, child) => total + getComposerNodeTextLength(child), 0);
  }
  return 0;
}

function getComposerNodeExpandedTextLength(node: LexicalNode): number {
  if (isComposerInlineTokenNode(node)) {
    return getComposerInlineTokenExpandedTextLength(node);
  }
  if ($isTextNode(node)) {
    return node.getTextContentSize();
  }
  if ($isLineBreakNode(node)) {
    return 1;
  }
  if ($isElementNode(node)) {
    return node
      .getChildren()
      .reduce((total, child) => total + getComposerNodeExpandedTextLength(child), 0);
  }
  return 0;
}

function getAbsoluteOffsetForPoint(node: LexicalNode, pointOffset: number): number {
  let offset = 0;
  let current: LexicalNode | null = node;

  while (current) {
    const nextParent = current.getParent() as LexicalNode | null;
    if (!nextParent || !$isElementNode(nextParent)) {
      break;
    }
    const siblings = nextParent.getChildren();
    const index = current.getIndexWithinParent();
    for (let i = 0; i < index; i += 1) {
      const sibling = siblings[i];
      if (!sibling) continue;
      offset += getComposerNodeTextLength(sibling);
    }
    current = nextParent;
  }

  if ($isTextNode(node)) {
    return offset + Math.min(pointOffset, node.getTextContentSize());
  }
  if (isComposerInlineTokenNode(node)) {
    return getAbsoluteOffsetForInlineTokenPoint(node, offset, pointOffset);
  }

  if ($isLineBreakNode(node)) {
    return offset + Math.min(pointOffset, 1);
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();
    const clampedOffset = Math.max(0, Math.min(pointOffset, children.length));
    for (let i = 0; i < clampedOffset; i += 1) {
      const child = children[i];
      if (!child) continue;
      offset += getComposerNodeTextLength(child);
    }
    return offset;
  }

  return offset;
}

function getExpandedAbsoluteOffsetForPoint(node: LexicalNode, pointOffset: number): number {
  let offset = 0;
  let current: LexicalNode | null = node;

  while (current) {
    const nextParent = current.getParent() as LexicalNode | null;
    if (!nextParent || !$isElementNode(nextParent)) {
      break;
    }
    const siblings = nextParent.getChildren();
    const index = current.getIndexWithinParent();
    for (let i = 0; i < index; i += 1) {
      const sibling = siblings[i];
      if (!sibling) continue;
      offset += getComposerNodeExpandedTextLength(sibling);
    }
    current = nextParent;
  }

  if ($isTextNode(node)) {
    return offset + Math.min(pointOffset, node.getTextContentSize());
  }
  if (isComposerInlineTokenNode(node)) {
    return getExpandedAbsoluteOffsetForInlineTokenPoint(node, offset, pointOffset);
  }

  if ($isLineBreakNode(node)) {
    return offset + Math.min(pointOffset, 1);
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();
    const clampedOffset = Math.max(0, Math.min(pointOffset, children.length));
    for (let i = 0; i < clampedOffset; i += 1) {
      const child = children[i];
      if (!child) continue;
      offset += getComposerNodeExpandedTextLength(child);
    }
    return offset;
  }

  return offset;
}

function findSelectionPointAtOffset(
  node: LexicalNode,
  remainingRef: { value: number },
): { key: string; offset: number; type: "text" | "element" } | null {
  if (isComposerInlineTokenNode(node)) {
    return findSelectionPointForInlineToken(node, remainingRef);
  }

  if ($isTextNode(node)) {
    const size = node.getTextContentSize();
    if (remainingRef.value <= size) {
      return {
        key: node.getKey(),
        offset: remainingRef.value,
        type: "text",
      };
    }
    remainingRef.value -= size;
    return null;
  }

  if ($isLineBreakNode(node)) {
    const parent = node.getParent();
    if (!parent) return null;
    const index = node.getIndexWithinParent();
    if (remainingRef.value === 0) {
      return {
        key: parent.getKey(),
        offset: index,
        type: "element",
      };
    }
    if (remainingRef.value === 1) {
      return {
        key: parent.getKey(),
        offset: index + 1,
        type: "element",
      };
    }
    remainingRef.value -= 1;
    return null;
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();
    for (const child of children) {
      const point = findSelectionPointAtOffset(child, remainingRef);
      if (point) {
        return point;
      }
    }
    if (remainingRef.value === 0) {
      return {
        key: node.getKey(),
        offset: children.length,
        type: "element",
      };
    }
  }

  return null;
}

function $getComposerRootLength(): number {
  const root = $getRoot();
  const children = root.getChildren();
  return children.reduce((sum, child) => sum + getComposerNodeTextLength(child), 0);
}

function $setSelectionAtComposerOffset(nextOffset: number): void {
  const root = $getRoot();
  const composerLength = $getComposerRootLength();
  const boundedOffset = Math.max(0, Math.min(nextOffset, composerLength));
  const remainingRef = { value: boundedOffset };
  const point = findSelectionPointAtOffset(root, remainingRef) ?? {
    key: root.getKey(),
    offset: root.getChildren().length,
    type: "element" as const,
  };
  const selection = $createRangeSelection();
  selection.anchor.set(point.key, point.offset, point.type);
  selection.focus.set(point.key, point.offset, point.type);
  $setSelection(selection);
}

function $setSelectionRangeAtComposerOffsets(startOffset: number, endOffset: number): void {
  const root = $getRoot();
  const composerLength = $getComposerRootLength();
  const boundedStart = Math.max(0, Math.min(startOffset, composerLength));
  const boundedEnd = Math.max(0, Math.min(endOffset, composerLength));
  const anchorRemainingRef = { value: boundedStart };
  const focusRemainingRef = { value: boundedEnd };
  const anchorPoint = findSelectionPointAtOffset(root, anchorRemainingRef) ?? {
    key: root.getKey(),
    offset: root.getChildren().length,
    type: "element" as const,
  };
  const focusPoint = findSelectionPointAtOffset(root, focusRemainingRef) ?? {
    key: root.getKey(),
    offset: root.getChildren().length,
    type: "element" as const,
  };
  const selection = $createRangeSelection();
  selection.anchor.set(anchorPoint.key, anchorPoint.offset, anchorPoint.type);
  selection.focus.set(focusPoint.key, focusPoint.offset, focusPoint.type);
  $setSelection(selection);
}

function getSelectionRangeForExpandedComposerOffsets(selection: ReturnType<typeof $getSelection>): {
  start: number;
  end: number;
} | null {
  if (!$isRangeSelection(selection)) {
    return null;
  }
  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();
  const anchorOffset = getExpandedAbsoluteOffsetForPoint(anchorNode, selection.anchor.offset);
  const focusOffset = getExpandedAbsoluteOffsetForPoint(focusNode, selection.focus.offset);
  return {
    start: Math.min(anchorOffset, focusOffset),
    end: Math.max(anchorOffset, focusOffset),
  };
}

function $selectionTouchesInlineToken(selection: ReturnType<typeof $getSelection>): boolean {
  if (!$isRangeSelection(selection)) {
    return false;
  }
  return selection.getNodes().some((node) => isComposerInlineTokenNode(node));
}

function $readSelectionOffsetFromEditorState(fallback: number): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return fallback;
  }
  const anchorNode = selection.anchor.getNode();
  const offset = getAbsoluteOffsetForPoint(anchorNode, selection.anchor.offset);
  const composerLength = $getComposerRootLength();
  return Math.max(0, Math.min(offset, composerLength));
}

function $readExpandedSelectionOffsetFromEditorState(fallback: number): number {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return fallback;
  }
  const anchorNode = selection.anchor.getNode();
  const offset = getExpandedAbsoluteOffsetForPoint(anchorNode, selection.anchor.offset);
  const expandedLength = $getRoot().getTextContent().length;
  return Math.max(0, Math.min(offset, expandedLength));
}

function $textWithLineBreaks(text: string): LexicalNode[] {
  return text
    .split("\n")
    .flatMap((line, index, lines) => [
      ...(line.length > 0 ? [$createTextNode(line)] : []),
      ...(index < lines.length - 1 ? [$createLineBreakNode()] : []),
    ]);
}

/** The nodes that draw a prompt: its words and line breaks, its chips, its pictures. */
function $composerPromptNodes(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft>,
  skillMetadata: ReadonlyMap<string, ComposerSkillMetadata>,
  crewmates: ReadonlyArray<ComposerCrewmateChip>,
  pictureIds: ReadonlyArray<string>,
  fileIds: ReadonlyArray<string>,
): LexicalNode[] {
  const segments = splitPromptIntoEditorSegments(
    prompt,
    terminalContexts,
    crewmates,
    pictureIds,
    fileIds,
  );
  return segments.flatMap((segment): LexicalNode[] => {
    switch (segment.type) {
      case "file":
        // A place whose file is gone draws nothing, and so drops out of the text.
        return segment.fileId === null ? [] : [$createComposerFileNode(segment.fileId)];
      case "picture":
        // A place whose picture is gone draws nothing, and so drops out of the text.
        return segment.imageId === null ? [] : [$createComposerPictureNode(segment.imageId)];
      case "mention":
        return [$createComposerMentionNode(segment.path, segment.source)];
      case "crewmate":
        return [$createComposerCrewmateNode(segment.handle, segment.tint)];
      case "skill": {
        const metadata = skillMetadata.get(segment.name);
        return [
          $createComposerSkillNode(
            segment.name,
            metadata?.label ?? formatProviderSkillDisplayName({ name: segment.name }),
            metadata?.description ?? null,
          ),
        ];
      }
      case "terminal-context":
        return segment.context ? [$createComposerTerminalContextNode(segment.context)] : [];
      default:
        return $textWithLineBreaks(segment.text);
    }
  });
}

function $setComposerEditorPrompt(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft>,
  skillMetadata: ReadonlyMap<string, ComposerSkillMetadata>,
  crewmates: ReadonlyArray<ComposerCrewmateChip>,
  pictureIds: ReadonlyArray<string>,
  fileIds: ReadonlyArray<string>,
): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  root.append(paragraph);
  paragraph.append(
    ...$composerPromptNodes(
      prompt,
      terminalContexts,
      skillMetadata,
      crewmates,
      pictureIds,
      fileIds,
    ),
  );
}

function collectTerminalContextIds(node: LexicalNode): string[] {
  if (node instanceof ComposerTerminalContextNode) {
    return [node.__context.id];
  }
  if ($isElementNode(node)) {
    return node.getChildren().flatMap((child) => collectTerminalContextIds(child));
  }
  return [];
}

/** The pictures the text holds, in the order they sit. */
function collectPictureIds(node: LexicalNode): string[] {
  if (node instanceof ComposerPictureNode) {
    return [node.__imageId];
  }
  if ($isElementNode(node)) {
    return node.getChildren().flatMap((child) => collectPictureIds(child));
  }
  return [];
}

/** The files the text holds, in the order they sit. */
function collectFileIds(node: LexicalNode): string[] {
  if (node instanceof ComposerFileNode) {
    return [node.__fileId];
  }
  if ($isElementNode(node)) {
    return node.getChildren().flatMap((child) => collectFileIds(child));
  }
  return [];
}

export interface ComposerEditorSnapshot {
  readonly value: string;
  readonly cursor: number;
  readonly expandedCursor: number;
  readonly terminalContextIds: ReadonlyArray<string>;
  readonly pictureIds: ReadonlyArray<string>;
  readonly fileIds: ReadonlyArray<string>;
}

/**
 * What the editor holds, in the screen's terms, read from whichever editor
 * state is active — the committed one, or the one an update is still writing.
 *
 * One reader for every caller — the change listener, the handle, and the
 * controlled write that records what it produced — so "what the editor holds"
 * is never two slightly different answers. The previous snapshot supplies the
 * fallbacks: a selection Lexical cannot place keeps the offset it had.
 */
function $readComposerEditorSnapshot(previous: ComposerEditorSnapshot): ComposerEditorSnapshot {
  const value = $getRoot().getTextContent();
  return {
    value,
    cursor: clampCollapsedComposerCursor(
      value,
      $readSelectionOffsetFromEditorState(clampCollapsedComposerCursor(value, previous.cursor)),
    ),
    expandedCursor: clampExpandedCursor(
      value,
      $readExpandedSelectionOffsetFromEditorState(
        clampExpandedCursor(value, previous.expandedCursor),
      ),
    ),
    terminalContextIds: collectTerminalContextIds($getRoot()),
    pictureIds: collectPictureIds($getRoot()),
    fileIds: collectFileIds($getRoot()),
  };
}

const sameIds = (one: ReadonlyArray<string>, other: ReadonlyArray<string>): boolean =>
  one.length === other.length && one.every((id, index) => id === other[index]);

function composerSnapshotsAgree(
  one: ComposerEditorSnapshot,
  other: ComposerEditorSnapshot,
): boolean {
  return (
    one.value === other.value &&
    one.cursor === other.cursor &&
    one.expandedCursor === other.expandedCursor &&
    sameIds(one.terminalContextIds, other.terminalContextIds) &&
    sameIds(one.pictureIds, other.pictureIds) &&
    sameIds(one.fileIds, other.fileIds)
  );
}

export interface ComposerPromptEditorHandle {
  focus: () => void;
  focusAt: (cursor: number) => void;
  focusAtEnd: () => void;
  readSnapshot: () => ComposerEditorSnapshot;
  /**
   * True when a collapsed caret sits on the first ("start") or last ("end")
   * visual line, counting soft wraps. Prompt history only claims ArrowUp and
   * ArrowDown at these edges so arrows still move the caret inside multiline
   * text.
   */
  isCaretOnVisualEdge: (edge: "start" | "end") => boolean;
}

interface ComposerPromptEditorProps {
  value: string;
  cursor: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  skills: ReadonlyArray<ServerProviderSkill>;
  /** The crewmates `@` offers (the lead's chat): their `@handle`s are drawn as them. */
  crewmates?: ReadonlyArray<ComposerCrewmateChip> | undefined;
  /** The draft's pictures in the order they sit, matched by order to the prompt's picture places. */
  pictures?: ReadonlyArray<ComposerPictureView> | undefined;
  onOpenPicture?: ((id: string) => void) | undefined;
  onRemovePicture?: ((id: string) => void) | undefined;
  onRetryPicture?: ((id: string) => void) | undefined;
  /**
   * Pictures copied from a composer's text are pasted with their words: the
   * id each picture's place takes, in order, or null for one the composer
   * cannot place again (its words still come).
   */
  onPastePictures?: ((ids: ReadonlyArray<string>) => ReadonlyArray<string | null>) | undefined;
  /** The draft's files in the order they sit, matched by order to the prompt's file places. */
  files?: ReadonlyArray<ComposerFileView> | undefined;
  onRemoveFile?: ((id: string) => void) | undefined;
  onRetryFile?: ((id: string) => void) | undefined;
  disabled: boolean;
  placeholder: string;
  className?: string;
  onRemoveTerminalContext: (contextId: string) => void;
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
    terminalContextIds: string[],
    pictureIds: string[],
    fileIds: string[],
  ) => void;
  onCommandKeyDown?: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Escape",
    event: KeyboardEvent,
  ) => boolean;
  onPaste: React.ClipboardEventHandler<HTMLElement>;
  editorRef: React.RefObject<ComposerPromptEditorHandle | null>;
}

/**
 * Client rect of the line the collapsed caret is on, as seen from `edge`.
 * A caret at a soft-wrap boundary belongs to two visual lines and the
 * range reports a rect for each, so take the one farthest from the edge
 * under test: an ambiguous caret then never claims the key and the arrow
 * moves the caret as usual. A collapsed range reports zero-height rects at
 * some positions, so probe the adjacent character on the same side. When
 * the range container is the paragraph itself (an empty line, or a caret
 * beside an inline chip) measure the child next to the caret before
 * falling back to the paragraph.
 */
function caretLineRect(range: Range, edge: "start" | "end"): DOMRect | null {
  const collapsedRects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
  const collapsedRect = edge === "start" ? collapsedRects.at(-1) : collapsedRects[0];
  if (collapsedRect) return collapsedRect;

  const container = range.startContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    const textNode = container as Text;
    if (textNode.data.length === 0) return null;
    const probeStart = Math.max(
      0,
      Math.min(
        edge === "start" ? range.startOffset : range.startOffset - 1,
        textNode.data.length - 1,
      ),
    );
    const probeRange = document.createRange();
    probeRange.setStart(textNode, probeStart);
    probeRange.setEnd(textNode, probeStart + 1);
    const probeRect = Array.from(probeRange.getClientRects()).find((rect) => rect.height > 0);
    if (probeRect) return probeRect;
    const boundingRect = probeRange.getBoundingClientRect();
    return boundingRect.height > 0 ? boundingRect : null;
  }

  if (!(container instanceof HTMLElement)) return null;
  // The caret sits between the paragraph's children, which is where Lexical
  // puts it next to an inline chip. Measure the neighbouring child.
  const neighbour =
    container.childNodes[Math.max(0, range.startOffset - 1)] ??
    container.childNodes[range.startOffset];
  if (neighbour instanceof HTMLElement) {
    const neighbourRect = neighbour.getBoundingClientRect();
    if (neighbourRect.height > 0) return neighbourRect;
  } else if (neighbour instanceof Text && neighbour.data.length > 0) {
    // Probe the character on the caret's side. A soft-wrapped text node's
    // first rect is its first visual line, which may not be the caret's.
    const isBeforeCaret = neighbour === container.childNodes[range.startOffset - 1];
    const probeStart = isBeforeCaret ? neighbour.data.length - 1 : 0;
    const probeRange = document.createRange();
    probeRange.setStart(neighbour, probeStart);
    probeRange.setEnd(neighbour, probeStart + 1);
    const probeRect = Array.from(probeRange.getClientRects()).find((rect) => rect.height > 0);
    if (probeRect) return probeRect;
  }
  const containerRect = container.getBoundingClientRect();
  return containerRect.height > 0 ? containerRect : null;
}

function ComposerCommandKeyPlugin(props: {
  onCommandKeyDown?: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Escape",
    event: KeyboardEvent,
  ) => boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const handleCommand = (
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Escape",
      event: KeyboardEvent | null,
    ): boolean => {
      if (!props.onCommandKeyDown || !event) {
        return false;
      }

      if (key === "Enter" && (event.isComposing || event.keyCode === 229)) {
        event.stopPropagation();
        return true;
      }

      const handled = props.onCommandKeyDown(key, event);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return handled;
    };

    const unregisterArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => handleCommand("ArrowDown", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => handleCommand("ArrowUp", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => handleCommand("Enter", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => handleCommand("Tab", event),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => handleCommand("Escape", event),
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterArrowDown();
      unregisterArrowUp();
      unregisterEnter();
      unregisterTab();
      unregisterEscape();
    };
  }, [editor, props]);

  return null;
}

function ComposerInlineTokenArrowPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => {
        let nextOffset: number | null = null;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const currentOffset = $readSelectionOffsetFromEditorState(0);
          if (currentOffset <= 0) return;
          const promptValue = $getRoot().getTextContent();
          if (!isCollapsedCursorAdjacentToInlineToken(promptValue, currentOffset, "left")) {
            return;
          }
          nextOffset = currentOffset - 1;
        });
        if (nextOffset === null) return false;
        const selectionOffset = nextOffset;
        event?.preventDefault();
        event?.stopPropagation();
        editor.update(() => {
          $setSelectionAtComposerOffset(selectionOffset);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        let nextOffset: number | null = null;
        editor.getEditorState().read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
          const currentOffset = $readSelectionOffsetFromEditorState(0);
          const composerLength = $getComposerRootLength();
          if (currentOffset >= composerLength) return;
          const promptValue = $getRoot().getTextContent();
          if (!isCollapsedCursorAdjacentToInlineToken(promptValue, currentOffset, "right")) {
            return;
          }
          nextOffset = currentOffset + 1;
        });
        if (nextOffset === null) return false;
        const selectionOffset = nextOffset;
        event?.preventDefault();
        event?.stopPropagation();
        editor.update(() => {
          $setSelectionAtComposerOffset(selectionOffset);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [editor]);

  return null;
}

function ComposerHomeEndKeyPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (!isMacPlatform(navigator.platform)) {
          return false;
        }
        if (event.key !== "Home" && event.key !== "End") {
          return false;
        }
        if (event.altKey || event.metaKey || event.ctrlKey || event.isComposing) {
          return false;
        }

        const rootElement = editor.getRootElement();
        const selection = window.getSelection();
        const anchorNode = selection?.anchorNode;
        if (!rootElement || !selection || !anchorNode || !rootElement.contains(anchorNode)) {
          return false;
        }
        if (selection.rangeCount === 0 || typeof selection.modify !== "function") {
          return false;
        }

        event.preventDefault();
        event.stopPropagation();

        selection.modify(
          event.shiftKey ? "extend" : "move",
          event.key === "Home" ? "backward" : "forward",
          "lineboundary",
        );
        editor.update(() => {
          $setSelection($createRangeSelectionFromDom(selection, editor));
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

function ComposerInlineTokenSelectionNormalizePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      let afterOffset: number | null = null;
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const anchorNode = selection.anchor.getNode();
        if (!isComposerInlineTokenNode(anchorNode)) return;
        if (selection.anchor.offset === 0) return;
        const beforeOffset = getAbsoluteOffsetForPoint(anchorNode, 0);
        afterOffset = beforeOffset + 1;
      });
      if (afterOffset !== null) {
        queueMicrotask(() => {
          editor.update(() => {
            $setSelectionAtComposerOffset(afterOffset!);
          });
        });
      }
    });
  }, [editor]);

  return null;
}

function ComposerInlineTokenBackspacePlugin() {
  const [editor] = useLexicalComposerContext();
  const { onRemoveTerminalContext } = use(ComposerTerminalContextActionsContext);

  useEffect(() => {
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const anchorNode = selection.anchor.getNode();
        const selectionOffset = $readSelectionOffsetFromEditorState(0);
        const removeInlineTokenNode = (candidate: unknown): boolean => {
          if (!isComposerInlineTokenNode(candidate)) {
            return false;
          }
          const tokenStart = getAbsoluteOffsetForPoint(candidate, 0);
          candidate.remove();
          if (candidate instanceof ComposerTerminalContextNode) {
            onRemoveTerminalContext(candidate.__context.id);
            $setSelectionAtComposerOffset(selectionOffset);
          } else {
            $setSelectionAtComposerOffset(tokenStart);
          }
          event?.preventDefault();
          return true;
        };
        if (removeInlineTokenNode(anchorNode)) {
          return true;
        }

        if ($isTextNode(anchorNode)) {
          if (selection.anchor.offset > 0) {
            return false;
          }
          if (removeInlineTokenNode(anchorNode.getPreviousSibling())) {
            return true;
          }
          const parent = anchorNode.getParent();
          if ($isElementNode(parent)) {
            const index = anchorNode.getIndexWithinParent();
            if (index > 0 && removeInlineTokenNode(parent.getChildAtIndex(index - 1))) {
              return true;
            }
          }
          return false;
        }

        if ($isElementNode(anchorNode)) {
          const childIndex = selection.anchor.offset - 1;
          if (childIndex >= 0 && removeInlineTokenNode(anchorNode.getChildAtIndex(childIndex))) {
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onRemoveTerminalContext]);

  return null;
}

/**
 * Chips render as non-editable decorators, so the browser never paints the
 * native text selection over them; without help, a selection spanning chips
 * is only visible in the slivers between them. Mirror the selection onto the
 * chips with a data attribute the stylesheet turns into a highlight overlay.
 */
function ComposerChipSelectionPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let selectedKeys = new Set<string>();
    // Lexical keeps the range selection on blur without emitting an update,
    // so focus is tracked separately; while blurred the native highlight is
    // gone and the mirrored one has to go with it.
    let hasFocus = editor.getRootElement() === document.activeElement;

    const applyKeys = (nextKeys: Set<string>) => {
      for (const key of selectedKeys) {
        if (!nextKeys.has(key)) {
          editor.getElementByKey(key)?.removeAttribute("data-composer-chip-selected");
        }
      }
      for (const key of nextKeys) {
        editor.getElementByKey(key)?.setAttribute("data-composer-chip-selected", "true");
      }
      selectedKeys = nextKeys;
    };

    const readSelectedKeys = () => {
      const nextKeys = new Set<string>();
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection) && !selection.isCollapsed()) {
          for (const node of selection.getNodes()) {
            if (node instanceof DecoratorNode) {
              nextKeys.add(node.getKey());
            }
          }
        }
      });
      return nextKeys;
    };

    const unregisterUpdate = editor.registerUpdateListener(() => {
      applyKeys(hasFocus ? readSelectedKeys() : new Set());
    });
    const unregisterFocus = editor.registerCommand(
      FOCUS_COMMAND,
      () => {
        hasFocus = true;
        applyKeys(readSelectedKeys());
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterBlur = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        hasFocus = false;
        applyKeys(new Set());
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      unregisterUpdate();
      unregisterFocus();
      unregisterBlur();
    };
  }, [editor]);

  return null;
}

/** A picture of this composer being dragged: its id, so a drop can move it. */
const PICTURE_DRAG_TYPE = "application/x-mate-composer-picture";

function $findComposerPicture(node: LexicalNode, imageId: string): ComposerPictureNode | null {
  if (node instanceof ComposerPictureNode) return node.__imageId === imageId ? node : null;
  if (!$isElementNode(node)) return null;
  for (const child of node.getChildren()) {
    const found = $findComposerPicture(child, imageId);
    if (found) return found;
  }
  return null;
}

/**
 * Moves a picture to a caret offset of the text as it stands (each picture
 * and chip one character), the caret following it. Dropped right before or
 * after itself, it stays.
 */
export function $moveComposerPicture(imageId: string, offset: number): void {
  const moved = $findComposerPicture($getRoot(), imageId);
  if (!moved) return;
  const start = getAbsoluteOffsetForPoint(moved, 0);
  if (offset === start || offset === start + 1) return;
  $setSelectionAtComposerOffset(offset);
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const copy = $createComposerPictureNode(imageId);
  selection.insertNodes([copy]);
  moved.remove();
  copy.selectNext(0, 0);
}

function caretRangeAtPoint(x: number, y: number): Range | null {
  if (typeof document.caretRangeFromPoint === "function") return document.caretRangeFromPoint(x, y);
  const position = document.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

/**
 * The caret offset under a drop. A drop on a picture goes before it from its
 * upper half and after it from its lower half, as it sits on a line of its own.
 */
function $offsetAtPoint(editor: LexicalEditor, event: DragEvent): number | null {
  const root = editor.getRootElement();
  const range = caretRangeAtPoint(event.clientX, event.clientY);
  if (!root || !range || !root.contains(range.startContainer)) return null;
  const container =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const slot = container?.closest(".composer-picture-slot");
  if (slot && root.contains(slot)) {
    const box = slot.getBoundingClientRect();
    if (event.clientY < box.top + box.height / 2) range.setStartBefore(slot);
    else range.setStartAfter(slot);
    range.collapse(true);
  }
  const domSelection = window.getSelection();
  if (!domSelection) return null;
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  const selection = $createRangeSelectionFromDom(domSelection, editor);
  return selection
    ? getAbsoluteOffsetForPoint(selection.anchor.getNode(), selection.anchor.offset)
    : null;
}

/**
 * Pictures move by drag and drop, and a file dropped on the text lands where
 * it is dropped. The plain-text plugin cancels every drag and drop in the
 * editor, so these run ahead of it.
 */
function ComposerPictureDragPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterDragStart = editor.registerCommand(
      DRAGSTART_COMMAND,
      (event) => {
        const picture =
          event.target instanceof Element ? event.target.closest("[data-composer-picture]") : null;
        const imageId = picture?.getAttribute("data-composer-picture");
        if (!picture || !imageId || !event.dataTransfer) return false;
        event.dataTransfer.setData(PICTURE_DRAG_TYPE, imageId);
        // Text in the drag lets the editor show its own drop caret.
        event.dataTransfer.setData("text/plain", "");
        event.dataTransfer.effectAllowed = "move";
        const image = picture.querySelector("img");
        if (image) event.dataTransfer.setDragImage(image, 24, 24);
        picture.setAttribute("data-dragging", "true");
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterDragEnd = editor.registerCommand(
      DRAGEND_COMMAND,
      () => {
        for (const picture of editor.getRootElement()?.querySelectorAll("[data-dragging]") ?? []) {
          picture.removeAttribute("data-dragging");
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterDrop = editor.registerCommand(
      DROP_COMMAND,
      (event) => {
        const types = new Set(Array.from(event.dataTransfer?.types ?? []));
        if (types.has(PICTURE_DRAG_TYPE)) {
          event.preventDefault();
          const imageId = event.dataTransfer?.getData(PICTURE_DRAG_TYPE) ?? "";
          editor.update(
            () => {
              const offset = $offsetAtPoint(editor, event);
              if (offset !== null) $moveComposerPicture(imageId, offset);
            },
            { discrete: true },
          );
          editor.getRootElement()?.focus({ preventScroll: true });
          return true;
        }
        if (types.has("Files")) {
          // The workspace drop adds the files at the caret: it goes under the pointer first.
          editor.update(
            () => {
              const offset = $offsetAtPoint(editor, event);
              if (offset !== null) $setSelectionAtComposerOffset(offset);
            },
            { discrete: true },
          );
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      unregisterDragStart();
      unregisterDragEnd();
      unregisterDrop();
    };
  }, [editor]);

  return null;
}

function ComposerInlineTokenPastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      registerComposerInlineTokenPaste(editor, {
        createMentionNode: $createComposerMentionNode,
        getExpandedAbsoluteOffsetForPoint,
      }),
    [editor],
  );

  return null;
}

/**
 * What a copy from the composer carries beside its words: the text with its
 * pictures' places, and their ids in the order they sit. A paste into a
 * composer of the same app reads it; anything else reads the plain words.
 */
export const COMPOSER_CLIPBOARD_TYPE = "application/x-mate-composer-text";

interface CopiedComposerText {
  readonly text: string;
  readonly pictures: ReadonlyArray<string>;
}

const withoutPlaces = (text: string): string =>
  text
    .replaceAll(INLINE_PICTURE_PLACEHOLDER, "")
    .replaceAll(INLINE_FILE_PLACEHOLDER, "")
    .replaceAll(INLINE_TERMINAL_CONTEXT_PLACEHOLDER, "");

const holdsPlaces = (text: string): boolean =>
  text.includes(INLINE_PICTURE_PLACEHOLDER) ||
  text.includes(INLINE_FILE_PLACEHOLDER) ||
  text.includes(INLINE_TERMINAL_CONTEXT_PLACEHOLDER);

function readCopiedComposerText(raw: string): CopiedComposerText | null {
  if (raw.length === 0) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { text, pictures } = value as Record<string, unknown>;
    if (typeof text !== "string" || !Array.isArray(pictures)) return null;
    if (!pictures.every((id): id is string => typeof id === "string")) return null;
    const places = [...text].filter((char) => char === INLINE_PICTURE_PLACEHOLDER).length;
    return places === pictures.length ? { text, pictures } : null;
  } catch {
    return null;
  }
}

/**
 * Copy, cut and paste of the composer's text. A picture's place is one
 * character of the text; it never reaches the clipboard as one, nor comes in
 * from it: the plain words go out and come in without places, and a copy
 * carries its pictures beside them (`COMPOSER_CLIPBOARD_TYPE`), so a picture
 * cut or copied moves or is copied with its words. A terminal context stays
 * where it is. Everything else is the plain-text plugin's, which runs after.
 */
function ComposerClipboardPlugin(props: {
  readonly onPastePictures: (ids: ReadonlyArray<string>) => ReadonlyArray<string | null>;
  readonly skillMetadataRef: React.RefObject<ReadonlyMap<string, ComposerSkillMetadata>>;
  readonly crewmatesRef: React.RefObject<ReadonlyArray<ComposerCrewmateChip>>;
}) {
  const [editor] = useLexicalComposerContext();
  const onPastePictures = useEffectEvent(props.onPastePictures);
  const { skillMetadataRef, crewmatesRef } = props;

  useEffect(() => {
    const copy = (event: ClipboardEvent | KeyboardEvent | null, cut: boolean): boolean => {
      const data = event instanceof ClipboardEvent ? event.clipboardData : null;
      const selection = $getSelection();
      if (!data || !$isRangeSelection(selection) || selection.isCollapsed()) return false;
      const text = selection.getTextContent();
      if (!holdsPlaces(text)) return false;
      event?.preventDefault();
      const pictures = selection
        .getNodes()
        .flatMap((node) => (node instanceof ComposerPictureNode ? [node.__imageId] : []));
      data.setData("text/plain", withoutPlaces(text));
      data.setData(
        COMPOSER_CLIPBOARD_TYPE,
        JSON.stringify({
          // A file stays where it is, as a terminal context does: its words go.
          text: text
            .replaceAll(INLINE_TERMINAL_CONTEXT_PLACEHOLDER, "")
            .replaceAll(INLINE_FILE_PLACEHOLDER, ""),
          pictures,
        } satisfies CopiedComposerText),
      );
      if (cut) selection.removeText();
      return true;
    };
    const paste = (event: ClipboardEvent | InputEvent | KeyboardEvent): boolean => {
      const data =
        event instanceof ClipboardEvent
          ? event.clipboardData
          : event instanceof InputEvent
            ? event.dataTransfer
            : null;
      const selection = $getSelection();
      if (!data || data.files.length > 0 || !$isRangeSelection(selection)) return false;
      const copied = readCopiedComposerText(data.getData(COMPOSER_CLIPBOARD_TYPE));
      if (copied) {
        event.preventDefault();
        const placed = onPastePictures(copied.pictures);
        let place = -1;
        const text = [...copied.text]
          .filter((char) => {
            if (char !== INLINE_PICTURE_PLACEHOLDER) return true;
            place += 1;
            return (placed[place] ?? null) !== null;
          })
          .join("");
        const ids = placed.filter((id): id is string => id !== null);
        selection.insertNodes(
          $composerPromptNodes(text, [], skillMetadataRef.current, crewmatesRef.current, ids, []),
        );
        return true;
      }
      const plain = data.getData("text/plain");
      if (!holdsPlaces(plain)) return false;
      event.preventDefault();
      selection.insertRawText(withoutPlaces(plain));
      return true;
    };
    const unregisterCopy = editor.registerCommand(
      COPY_COMMAND,
      (event) => copy(event, false),
      COMMAND_PRIORITY_CRITICAL,
    );
    const unregisterCut = editor.registerCommand(
      CUT_COMMAND,
      (event) => copy(event, true),
      COMMAND_PRIORITY_CRITICAL,
    );
    const unregisterPaste = editor.registerCommand(PASTE_COMMAND, paste, COMMAND_PRIORITY_CRITICAL);
    return () => {
      unregisterCopy();
      unregisterCut();
      unregisterPaste();
    };
  }, [crewmatesRef, editor, skillMetadataRef]);

  return null;
}

function ComposerSurroundSelectionPlugin(props: {
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  skills: ReadonlyArray<ServerProviderSkill>;
  crewmates: ReadonlyArray<ComposerCrewmateChip>;
  pictureIds: ReadonlyArray<string>;
  fileIds: ReadonlyArray<string>;
}) {
  const [editor] = useLexicalComposerContext();
  const terminalContextsRef = useRef(props.terminalContexts);
  const pictureIdsRef = useRef(props.pictureIds);
  const fileIdsRef = useRef(props.fileIds);
  const skillMetadataRef = useRef(skillMetadataByName(props.skills));
  const crewmatesRef = useRef(props.crewmates);
  const pendingSurroundSelectionRef = useRef<{
    value: string;
    expandedStart: number;
    expandedEnd: number;
  } | null>(null);
  const pendingDeadKeySelectionRef = useRef<{
    value: string;
    expandedStart: number;
    expandedEnd: number;
  } | null>(null);

  useEffect(() => {
    terminalContextsRef.current = props.terminalContexts;
  }, [props.terminalContexts]);

  useEffect(() => {
    skillMetadataRef.current = skillMetadataByName(props.skills);
  }, [props.skills]);

  useEffect(() => {
    crewmatesRef.current = props.crewmates;
  }, [props.crewmates]);

  useEffect(() => {
    pictureIdsRef.current = props.pictureIds;
  }, [props.pictureIds]);

  useEffect(() => {
    fileIdsRef.current = props.fileIds;
  }, [props.fileIds]);

  const applySurroundInsertion = useEffectEvent((inputData: string): boolean => {
    const surroundCloseSymbol = SURROUND_SYMBOLS_MAP.get(inputData);
    const pendingSurroundSelection = pendingSurroundSelectionRef.current;
    if (!surroundCloseSymbol) {
      pendingSurroundSelectionRef.current = null;
      return false;
    }

    let handled = false;
    editor.update(() => {
      const selectionSnapshot =
        pendingSurroundSelection ??
        (() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || selection.isCollapsed()) {
            return null;
          }
          if ($selectionTouchesInlineToken(selection)) {
            return null;
          }
          const range = getSelectionRangeForExpandedComposerOffsets(selection);
          if (!range || range.start === range.end) {
            return null;
          }
          const value = $getRoot().getTextContent();
          if (selectionTouchesMentionBoundary(value, range.start, range.end)) {
            return null;
          }
          return {
            value,
            expandedStart: range.start,
            expandedEnd: range.end,
          };
        })();

      if (!selectionSnapshot || !surroundCloseSymbol) {
        return;
      }

      const selectedText = selectionSnapshot.value.slice(
        selectionSnapshot.expandedStart,
        selectionSnapshot.expandedEnd,
      );
      const nextValue = `${selectionSnapshot.value.slice(0, selectionSnapshot.expandedStart)}${inputData}${selectedText}${surroundCloseSymbol}${selectionSnapshot.value.slice(selectionSnapshot.expandedEnd)}`;
      $setComposerEditorPrompt(
        nextValue,
        terminalContextsRef.current,
        skillMetadataRef.current,
        crewmatesRef.current,
        pictureIdsRef.current,
        fileIdsRef.current,
      );
      const selectionStart = collapseExpandedComposerCursor(
        nextValue,
        selectionSnapshot.expandedStart,
      );
      $setSelectionRangeAtComposerOffsets(
        selectionStart + inputData.length,
        selectionStart + inputData.length + selectedText.length,
      );
      handled = true;
      pendingSurroundSelectionRef.current = null;
    });

    return handled;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pendingDeadKeySelectionRef.current) {
        if (event.key === "Dead" || event.key === " " || event.code === "Space") {
          return;
        }
        pendingDeadKeySelectionRef.current = null;
      }

      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey) {
        pendingSurroundSelectionRef.current = null;
        pendingDeadKeySelectionRef.current = null;
        return;
      }

      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selection.isCollapsed()) {
          pendingSurroundSelectionRef.current = null;
          pendingDeadKeySelectionRef.current = null;
          return;
        }
        if ($selectionTouchesInlineToken(selection)) {
          pendingSurroundSelectionRef.current = null;
          pendingDeadKeySelectionRef.current = null;
          return;
        }
        const range = getSelectionRangeForExpandedComposerOffsets(selection);
        if (!range || range.start === range.end) {
          pendingSurroundSelectionRef.current = null;
          pendingDeadKeySelectionRef.current = null;
          return;
        }
        const value = $getRoot().getTextContent();
        if (selectionTouchesMentionBoundary(value, range.start, range.end)) {
          pendingSurroundSelectionRef.current = null;
          pendingDeadKeySelectionRef.current = null;
          return;
        }
        const snapshot = {
          value,
          expandedStart: range.start,
          expandedEnd: range.end,
        };
        pendingSurroundSelectionRef.current = snapshot;
        pendingDeadKeySelectionRef.current = null;
      });
    };

    const onBeforeInput = (event: InputEvent) => {
      if (
        event.inputType === "insertCompositionText" &&
        event.data === "`" &&
        BACKTICK_SURROUND_CLOSE_SYMBOL !== null &&
        pendingSurroundSelectionRef.current
      ) {
        pendingDeadKeySelectionRef.current = pendingSurroundSelectionRef.current;
        return;
      }

      if (pendingDeadKeySelectionRef.current) {
        return;
      }

      if (event.inputType === "insertCompositionText") {
        return;
      }

      if (typeof event.data !== "string") {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      const inputData = event.inputType === "insertText" ? event.data : null;
      if (!inputData || inputData.length !== 1) {
        pendingSurroundSelectionRef.current = null;
        return;
      }
      if (!applySurroundInsertion(inputData)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const tryApplyDeadKeyBacktickSurround = (options?: { finalAttempt?: boolean }) => {
      queueMicrotask(() => {
        editor.update(
          () => {
            const pendingDeadKeySelection = pendingDeadKeySelectionRef.current;
            if (!pendingDeadKeySelection) {
              return;
            }

            const currentValue = $getRoot().getTextContent();
            const backtickCloseSymbol = BACKTICK_SURROUND_CLOSE_SYMBOL;
            if (backtickCloseSymbol === null) {
              pendingDeadKeySelectionRef.current = null;
              return;
            }

            const expectedResolvedValue = `${pendingDeadKeySelection.value.slice(0, pendingDeadKeySelection.expandedStart)}\`${pendingDeadKeySelection.value.slice(pendingDeadKeySelection.expandedEnd)}`;
            if (currentValue !== expectedResolvedValue) {
              if (options?.finalAttempt) {
                pendingSurroundSelectionRef.current = null;
                pendingDeadKeySelectionRef.current = null;
              }
              return;
            }

            const selectedText = pendingDeadKeySelection.value.slice(
              pendingDeadKeySelection.expandedStart,
              pendingDeadKeySelection.expandedEnd,
            );
            const replacementStart = collapseExpandedComposerCursor(
              currentValue,
              pendingDeadKeySelection.expandedStart,
            );
            $setSelectionRangeAtComposerOffsets(replacementStart, replacementStart + 1);
            const replacementSelection = $getSelection();
            if (!$isRangeSelection(replacementSelection)) {
              pendingSurroundSelectionRef.current = null;
              pendingDeadKeySelectionRef.current = null;
              return;
            }
            replacementSelection.insertText(`\`${selectedText}${backtickCloseSymbol}`);
            $setSelectionRangeAtComposerOffsets(
              replacementStart + 1,
              replacementStart + 1 + selectedText.length,
            );
            pendingSurroundSelectionRef.current = null;
            pendingDeadKeySelectionRef.current = null;
          },
          { tag: HISTORY_MERGE_TAG },
        );
      });
    };

    const onInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      if (
        inputEvent.inputType === "insertText" ||
        inputEvent.inputType === "insertCompositionText"
      ) {
        tryApplyDeadKeyBacktickSurround();
      }
    };

    const onCompositionEnd = () => {
      tryApplyDeadKeyBacktickSurround({ finalAttempt: true });
    };

    let activeRootElement: HTMLElement | null = null;
    const unregisterRootListener = editor.registerRootListener((rootElement, prevRootElement) => {
      prevRootElement?.removeEventListener("keydown", onKeyDown);
      prevRootElement?.removeEventListener("beforeinput", onBeforeInput, true);
      prevRootElement?.removeEventListener("input", onInput);
      prevRootElement?.removeEventListener("compositionend", onCompositionEnd);
      rootElement?.addEventListener("keydown", onKeyDown);
      rootElement?.addEventListener("beforeinput", onBeforeInput, true);
      rootElement?.addEventListener("input", onInput);
      rootElement?.addEventListener("compositionend", onCompositionEnd);
      activeRootElement = rootElement;
    });

    return () => {
      if (activeRootElement) {
        activeRootElement.removeEventListener("keydown", onKeyDown);
        activeRootElement.removeEventListener("beforeinput", onBeforeInput, true);
        activeRootElement.removeEventListener("input", onInput);
        activeRootElement.removeEventListener("compositionend", onCompositionEnd);
      }
      unregisterRootListener();
    };
  }, [editor]);

  return null;
}

function ComposerPromptEditorInner({
  value,
  cursor,
  terminalContexts,
  skills,
  crewmates = NO_CREWMATES,
  pictures = NO_PICTURES,
  onOpenPicture = IGNORE_PICTURE,
  onRemovePicture = IGNORE_PICTURE,
  onRetryPicture = IGNORE_PICTURE,
  onPastePictures = PLACE_NO_PICTURES,
  files = NO_FILE_VIEWS,
  onRemoveFile = IGNORE_PICTURE,
  onRetryFile = IGNORE_PICTURE,
  disabled,
  placeholder,
  className,
  onRemoveTerminalContext,
  onChange,
  onCommandKeyDown,
  onPaste,
  editorRef,
}: ComposerPromptEditorProps) {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);
  const initialCursor = clampCollapsedComposerCursor(value, cursor);
  const terminalContextsSignature = terminalContextSignature(terminalContexts);
  const terminalContextsSignatureRef = useRef(terminalContextsSignature);
  const skillsSignature = skillSignature(skills);
  const skillsSignatureRef = useRef(skillsSignature);
  const skillMetadataRef = useRef(skillMetadataByName(skills));
  // The crewmates the chat hands fresh on every snapshot: the sync keys on
  // their signature, and reads them from here.
  const crewmatesSignature = crewmateSignature(crewmates);
  const crewmatesSignatureRef = useRef(crewmatesSignature);
  const crewmatesRef = useRef(crewmates);
  // The pictures' order is what the text is rebuilt from; what each shows
  // (its thumbnail, its upload) reaches the decorators through context alone.
  const pictureIdsSignature = pictures.map((picture) => picture.id).join("\u001f");
  const pictureIdsSignatureRef = useRef(pictureIdsSignature);
  const pictureIds = useMemo(
    () => (pictureIdsSignature.length > 0 ? pictureIdsSignature.split("\u001f") : []),
    [pictureIdsSignature],
  );
  const pictureIdsRef = useRef(pictureIds);
  // The files' order, as the pictures': what the text is rebuilt from.
  const fileIdsSignature = files.map((file) => file.id).join("\u001f");
  const fileIdsSignatureRef = useRef(fileIdsSignature);
  const fileIds = useMemo(
    () => (fileIdsSignature.length > 0 ? fileIdsSignature.split("\u001f") : []),
    [fileIdsSignature],
  );
  const fileIdsRef = useRef(fileIds);
  const filesValue = useMemo<ComposerFilesValue>(
    () => ({
      files: new Map(files.map((file) => [file.id, file])),
      onRemoveFile,
      onRetryFile,
    }),
    [files, onRemoveFile, onRetryFile],
  );
  const picturesValue = useMemo<ComposerPicturesValue>(
    () => ({
      pictures: new Map(pictures.map((picture) => [picture.id, picture])),
      onOpenPicture,
      onRemovePicture,
      onRetryPicture,
    }),
    [onOpenPicture, onRemovePicture, onRetryPicture, pictures],
  );
  // The contexts the sync below writes into the editor. Held in a ref because
  // the screen builds this list fresh on every render — a thread with no
  // contexts hands a new empty array each time — and keying the sync to the
  // identity would run it, and touch the editor, for every render of the chat.
  const terminalContextsRef = useRef(terminalContexts);
  const snapshotRef = useRef<ComposerEditorSnapshot>({
    value,
    cursor: initialCursor,
    expandedCursor: expandCollapsedComposerCursor(value, initialCursor),
    terminalContextIds: terminalContexts.map((context) => context.id),
    pictureIds,
    fileIds,
  });
  const terminalContextActions = useMemo(
    () => ({ onRemoveTerminalContext }),
    [onRemoveTerminalContext],
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useLayoutEffect(() => {
    skillMetadataRef.current = skillMetadataByName(skills);
    terminalContextsRef.current = terminalContexts;
    crewmatesRef.current = crewmates;
    pictureIdsRef.current = pictureIds;
    fileIdsRef.current = fileIds;
  }, [crewmates, fileIds, pictureIds, skills, terminalContexts]);

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useLayoutEffect(() => {
    const normalizedCursor = clampCollapsedComposerCursor(value, cursor);
    const previousSnapshot = snapshotRef.current;
    const contextsChanged =
      terminalContextsSignatureRef.current !== terminalContextsSignature ||
      pictureIdsSignatureRef.current !== pictureIdsSignature ||
      fileIdsSignatureRef.current !== fileIdsSignature;
    const chipsChanged =
      skillsSignatureRef.current !== skillsSignature ||
      crewmatesSignatureRef.current !== crewmatesSignature;
    if (
      previousSnapshot.value === value &&
      previousSnapshot.cursor === normalizedCursor &&
      !contextsChanged &&
      !chipsChanged
    ) {
      return;
    }

    const contexts = terminalContextsRef.current;
    snapshotRef.current = {
      value,
      cursor: normalizedCursor,
      expandedCursor: expandCollapsedComposerCursor(value, normalizedCursor),
      terminalContextIds: contexts.map((context) => context.id),
      pictureIds: pictureIdsRef.current,
      fileIds: fileIdsRef.current,
    };
    terminalContextsSignatureRef.current = terminalContextsSignature;
    pictureIdsSignatureRef.current = pictureIdsSignature;
    fileIdsSignatureRef.current = fileIdsSignature;
    skillsSignatureRef.current = skillsSignature;
    crewmatesSignatureRef.current = crewmatesSignature;

    const rootElement = editor.getRootElement();
    const isFocused = Boolean(rootElement && document.activeElement === rootElement);
    if (previousSnapshot.value === value && !contextsChanged && !chipsChanged && !isFocused) {
      return;
    }

    editor.update(() => {
      const shouldRewriteEditorState =
        previousSnapshot.value !== value || contextsChanged || chipsChanged;
      if (shouldRewriteEditorState) {
        $setComposerEditorPrompt(
          value,
          contexts,
          skillMetadataRef.current,
          crewmatesRef.current,
          pictureIdsRef.current,
          fileIdsRef.current,
        );
      }
      if (shouldRewriteEditorState || isFocused) {
        $setSelectionAtComposerOffset(normalizedCursor);
      }
      // Record what the editor holds now, not what it was asked to hold. This
      // write comes back through the change listener as if someone had typed
      // it, and the listener stays quiet only for a report that matches the
      // snapshot: matching on the truth is what makes the echo silent whenever
      // its commit lands, and leaves a keystroke carried by the same commit
      // loud. A window of time that guessed at the same thing swallowed that
      // keystroke, and the screen and the editor then rewrote each other
      // (`verified.md`, 2026-09-18).
      snapshotRef.current = $readComposerEditorSnapshot(snapshotRef.current);
    });
  }, [
    cursor,
    crewmatesSignature,
    editor,
    fileIdsSignature,
    pictureIdsSignature,
    skillsSignature,
    terminalContextsSignature,
    value,
  ]);

  const focusAt = useCallback(
    (nextCursor: number) => {
      const rootElement = editor.getRootElement();
      if (!rootElement) return;
      const boundedCursor = clampCollapsedComposerCursor(snapshotRef.current.value, nextCursor);
      rootElement.focus({ preventScroll: true });
      editor.update(() => {
        $setSelectionAtComposerOffset(boundedCursor);
        snapshotRef.current = $readComposerEditorSnapshot(snapshotRef.current);
      });
      const snapshot = snapshotRef.current;
      onChangeRef.current(
        snapshot.value,
        snapshot.cursor,
        snapshot.expandedCursor,
        false,
        [...snapshot.terminalContextIds],
        [...snapshot.pictureIds],
        [...snapshot.fileIds],
      );
    },
    [editor],
  );

  const readSnapshot = useCallback((): ComposerEditorSnapshot => {
    let snapshot = snapshotRef.current;
    editor.getEditorState().read(() => {
      snapshot = $readComposerEditorSnapshot(snapshotRef.current);
    });
    snapshotRef.current = snapshot;
    return snapshot;
  }, [editor]);

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        focusAt(snapshotRef.current.cursor);
      },
      focusAt,
      focusAtEnd: () => {
        focusAt(
          collapseExpandedComposerCursor(
            snapshotRef.current.value,
            snapshotRef.current.value.length,
          ),
        );
      },
      readSnapshot,
      isCaretOnVisualEdge: (edge) => {
        const snapshot = readSnapshot();
        if (snapshot.value.length === 0) return true;
        const beforeCaret = snapshot.value.slice(0, snapshot.expandedCursor);
        const afterCaret = snapshot.value.slice(snapshot.expandedCursor);
        if (edge === "start" ? beforeCaret.includes("\n") : afterCaret.includes("\n")) {
          return false;
        }
        const rootElement = editor.getRootElement();
        const selection = window.getSelection();
        if (
          !rootElement ||
          !selection ||
          !selection.isCollapsed ||
          selection.rangeCount === 0 ||
          !selection.anchorNode ||
          !rootElement.contains(selection.anchorNode)
        ) {
          return false;
        }
        const caretRect = caretLineRect(selection.getRangeAt(0), edge);
        if (!caretRect) return false;
        const edgeElement =
          edge === "start" ? rootElement.firstElementChild : rootElement.lastElementChild;
        const edgeRect = (edgeElement ?? rootElement).getBoundingClientRect();
        const threshold = caretRect.height / 2;
        return edge === "start"
          ? caretRect.top - edgeRect.top < threshold
          : edgeRect.bottom - caretRect.bottom < threshold;
      },
    }),
    [focusAt, readSnapshot],
  );

  const handleEditorChange = useCallback((editorState: EditorState) => {
    editorState.read(() => {
      const previousSnapshot = snapshotRef.current;
      const snapshot = $readComposerEditorSnapshot(previousSnapshot);
      // Nothing the screen does not already know — which is every echo of its
      // own writes, and every update that moved no text and no caret.
      if (composerSnapshotsAgree(previousSnapshot, snapshot)) {
        return;
      }
      snapshotRef.current = snapshot;
      const cursorAdjacentToMention =
        isCollapsedCursorAdjacentToInlineToken(snapshot.value, snapshot.cursor, "left") ||
        isCollapsedCursorAdjacentToInlineToken(snapshot.value, snapshot.cursor, "right");
      onChangeRef.current(
        snapshot.value,
        snapshot.cursor,
        snapshot.expandedCursor,
        cursorAdjacentToMention,
        [...snapshot.terminalContextIds],
        [...snapshot.pictureIds],
        [...snapshot.fileIds],
      );
    });
  }, []);

  return (
    <ComposerTerminalContextActionsContext value={terminalContextActions}>
      <ComposerPicturesContext value={picturesValue}>
        <ComposerFilesContext value={filesValue}>
          <div className={COMPOSER_PROMPT_TYPE_CLASS_NAME}>
            <PlainTextPlugin
              contentEditable={
                <ContentEditable
                  className={cn(
                    // The wrapper owns the appearance preference; keep everything else here.
                    "block max-h-50 min-h-17.5 w-full overflow-y-auto whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none",
                    className,
                  )}
                  data-testid="composer-editor"
                  aria-placeholder={placeholder}
                  placeholder={<span />}
                  onPaste={onPaste}
                />
              }
              placeholder={
                terminalContexts.length > 0 || pictures.length > 0 || files.length > 0 ? null : (
                  <div className="pointer-events-none absolute inset-0 leading-relaxed text-placeholder">
                    {placeholder}
                  </div>
                )
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <OnChangePlugin onChange={handleEditorChange} />
            <ComposerCommandKeyPlugin {...(onCommandKeyDown ? { onCommandKeyDown } : {})} />
            <ComposerSurroundSelectionPlugin
              crewmates={crewmates}
              pictureIds={pictureIds}
              fileIds={fileIds}
              skills={skills}
              terminalContexts={terminalContexts}
            />
            <ComposerHomeEndKeyPlugin />
            <ComposerInlineTokenArrowPlugin />
            <ComposerInlineTokenSelectionNormalizePlugin />
            <ComposerInlineTokenBackspacePlugin />
            <ComposerInlineTokenPastePlugin />
            <ComposerClipboardPlugin
              onPastePictures={onPastePictures}
              skillMetadataRef={skillMetadataRef}
              crewmatesRef={crewmatesRef}
            />
            <ComposerPictureDragPlugin />
            <ComposerChipSelectionPlugin />
            <HistoryPlugin />
          </div>
        </ComposerFilesContext>
      </ComposerPicturesContext>
    </ComposerTerminalContextActionsContext>
  );
}

export function ComposerPromptEditor({
  value,
  cursor,
  terminalContexts,
  skills,
  crewmates = NO_CREWMATES,
  pictures = NO_PICTURES,
  onOpenPicture,
  onRemovePicture,
  onRetryPicture,
  onPastePictures,
  files = NO_FILE_VIEWS,
  onRemoveFile,
  onRetryFile,
  disabled,
  placeholder,
  className,
  onRemoveTerminalContext,
  onChange,
  onCommandKeyDown,
  onPaste,
  editorRef,
}: ComposerPromptEditorProps) {
  const initialValueRef = useRef(value);
  const initialTerminalContextsRef = useRef(terminalContexts);
  const initialSkillMetadataRef = useRef(skillMetadataByName(skills));
  const initialCrewmatesRef = useRef(crewmates);
  const initialPictureIdsRef = useRef(pictures.map((picture) => picture.id));
  const initialFileIdsRef = useRef(files.map((file) => file.id));
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "t3tools-composer-editor",
      editable: true,
      nodes: [
        ComposerMentionNode,
        ComposerCrewmateNode,
        ComposerSkillNode,
        ComposerTerminalContextNode,
        ComposerPictureNode,
        ComposerFileNode,
      ],
      editorState: () => {
        $setComposerEditorPrompt(
          initialValueRef.current,
          initialTerminalContextsRef.current,
          initialSkillMetadataRef.current,
          initialCrewmatesRef.current,
          initialPictureIdsRef.current,
          initialFileIdsRef.current,
        );
      },
      onError: (error) => {
        throw error;
      },
    }),
    [],
  );

  return (
    <LexicalComposer key={COMPOSER_EDITOR_HMR_KEY} initialConfig={initialConfig}>
      <ComposerPromptEditorInner
        value={value}
        cursor={cursor}
        terminalContexts={terminalContexts}
        skills={skills}
        crewmates={crewmates}
        pictures={pictures}
        onOpenPicture={onOpenPicture}
        onRemovePicture={onRemovePicture}
        onRetryPicture={onRetryPicture}
        onPastePictures={onPastePictures}
        files={files}
        onRemoveFile={onRemoveFile}
        onRetryFile={onRetryFile}
        disabled={disabled}
        placeholder={placeholder}
        onRemoveTerminalContext={onRemoveTerminalContext}
        onChange={onChange}
        onPaste={onPaste}
        editorRef={editorRef}
        {...(onCommandKeyDown ? { onCommandKeyDown } : {})}
        {...(className ? { className } : {})}
      />
    </LexicalComposer>
  );
}
