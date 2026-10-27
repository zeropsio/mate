/**
 * A file where it sits in the composer's text: a quiet chip with the file's
 * icon, its name (cut in the middle, so its extension stays) and its size.
 * While it uploads the size gives way to how far along it is; a failed upload
 * offers to try again; its × (or Backspace and Delete on it) removes it. It
 * is a Lexical decorator's content, so it reads what it shows from the
 * composer, by the file's id.
 */
import { RotateCcwIcon, XIcon } from "lucide-react";
import { createContext, use, type KeyboardEvent } from "react";

import { useTheme } from "~/hooks/useTheme";
import { formatAttachmentUploadProgress } from "~/lib/attachmentUploadState";
import { fileChipName } from "~/lib/composerFiles";
import { inferEntryKindFromPath } from "../../pierre-icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatPictureBytes } from "./ComposerPictureView";
import { PierreEntryIcon } from "./PierreEntryIcon";

/** The longest name a sent file's chip shows before it cuts it in the middle. */
const CHIP_NAME_CHARS = 28;

/** The composer's card is narrower: its name is cut sooner, never at its end. */
const CARD_NAME_CHARS = 19;

/** What the text shows of a file: everything but its bytes. */
export interface ComposerFileView {
  readonly id: string;
  /** Its number among the files, in the order they sit. */
  readonly number: number;
  readonly name: string;
  readonly sizeBytes: number;
  readonly status: "uploading" | "ready" | "failed";
  /** How far the upload is, 0 to 1, while it uploads. */
  readonly progress: number;
}

export interface ComposerFilesValue {
  readonly files: ReadonlyMap<string, ComposerFileView>;
  readonly onRemoveFile: (id: string) => void;
  readonly onRetryFile: (id: string) => void;
}

export const NO_FILES: ComposerFilesValue = {
  files: new Map(),
  onRemoveFile: () => {},
  onRetryFile: () => {},
};

export const ComposerFilesContext = createContext<ComposerFilesValue>(NO_FILES);

/** A file's face: its icon, its name and a quiet line beside it. */
export function AttachedFileFace(props: {
  readonly name: string;
  readonly detail: string;
  readonly theme: "light" | "dark";
  /** The longest name it shows before cutting it in the middle. */
  readonly nameChars?: number;
}) {
  const shown = fileChipName(props.name, props.nameChars ?? CHIP_NAME_CHARS);
  return (
    <>
      <PierreEntryIcon
        pathValue={props.name}
        kind={inferEntryKindFromPath(props.name)}
        theme={props.theme}
        className="attached-file-icon"
      />
      {shown === props.name ? (
        <span className="attached-file-name">{shown}</span>
      ) : (
        // A name cut short shows whole on hover.
        <Tooltip>
          <TooltipTrigger render={<span className="attached-file-name" />}>{shown}</TooltipTrigger>
          <TooltipPopup side="top">{props.name}</TooltipPopup>
        </Tooltip>
      )}
      <span className="attached-file-detail">{props.detail}</span>
    </>
  );
}

export function ComposerFile({ id }: { readonly id: string }) {
  const { files, onRemoveFile, onRetryFile } = use(ComposerFilesContext);
  const { resolvedTheme } = useTheme();
  const file = files.get(id);
  if (!file) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    // The editor listens on its root: keys meant for the file stop here.
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      onRemoveFile(id);
    }
  };
  const detail =
    file.status === "uploading"
      ? formatAttachmentUploadProgress(file.progress)
      : file.status === "failed"
        ? "Not uploaded"
        : formatPictureBytes(file.sizeBytes);
  return (
    <span
      className="composer-file"
      data-composer-file={id}
      data-status={file.status}
      role="group"
      tabIndex={0}
      aria-label={`File ${file.number}, ${file.name}, ${formatPictureBytes(file.sizeBytes)}`}
      onKeyDown={onKeyDown}
    >
      <AttachedFileFace
        name={file.name}
        detail={detail}
        theme={resolvedTheme}
        nameChars={CARD_NAME_CHARS}
      />
      {file.status === "failed" ? (
        <button
          type="button"
          className="composer-file-action composer-file-retry"
          aria-label={`Upload file ${file.number} again`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onRetryFile(id)}
        >
          <RotateCcwIcon aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="composer-file-action composer-file-remove"
        tabIndex={-1}
        aria-label={`Remove file ${file.number}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onRemoveFile(id)}
      >
        <XIcon aria-hidden="true" />
      </button>
    </span>
  );
}
