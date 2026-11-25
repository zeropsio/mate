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
import { Button } from "../ui/button";
import { PictureFrame } from "../ui/picture-frame";
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

const NO_FILES: ComposerFilesValue = {
  files: new Map(),
  onRemoveFile: () => {},
  onRetryFile: () => {},
};

export const ComposerFilesContext = createContext<ComposerFilesValue>(NO_FILES);

const FILE_NAME_CLASS_NAME = "truncate text-line leading-4.5 font-medium";

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
        className="in-data-composer-file:size-5"
      />
      {shown === props.name ? (
        <span className={FILE_NAME_CLASS_NAME}>{shown}</span>
      ) : (
        // A name cut short shows whole on hover.
        <Tooltip>
          <TooltipTrigger render={<span className={FILE_NAME_CLASS_NAME} />}>
            {shown}
          </TooltipTrigger>
          <TooltipPopup side="top">{props.name}</TooltipPopup>
        </Tooltip>
      )}
      <span className="shrink-0 text-caption tabular-nums text-muted-foreground in-data-composer-file:-mt-1.5 group-data-[status=failed]/file:text-warning-foreground">
        {props.detail}
      </span>
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
    // In a picture's frame, as tall as a picture, so a row of pictures and files reads as one
    // gallery; a ring when focused or picked, amber when its upload did not go through.
    <span
      className="group/file relative inline-flex h-20 w-42 max-w-full cursor-default rounded-control outline-none transition-shadow duration-150 ease-out-strong focus-visible:ring-2 focus-visible:ring-ring in-data-composer-chip-selected:ring-2 in-data-composer-chip-selected:ring-ring data-[status=failed]:ring-2 data-[status=failed]:ring-warning"
      data-composer-file={id}
      data-status={file.status}
      role="group"
      tabIndex={0}
      aria-label={`File ${file.number}, ${file.name}, ${formatPictureBytes(file.sizeBytes)}`}
      onKeyDown={onKeyDown}
    >
      <PictureFrame className="size-full" size="control">
        <span className="flex size-full flex-col justify-between px-3 py-2.5 leading-normal text-foreground">
          <AttachedFileFace
            name={file.name}
            detail={detail}
            theme={resolvedTheme}
            nameChars={CARD_NAME_CHARS}
          />
        </span>
      </PictureFrame>
      {file.status === "failed" ? (
        <span className="absolute right-2 bottom-2 flex">
          <Button
            variant="secondary"
            size="icon-2xs"
            shape="round"
            aria-label={`Upload file ${file.number} again`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRetryFile(id)}
          >
            <RotateCcwIcon aria-hidden="true" className="text-warning-foreground" />
          </Button>
        </span>
      ) : null}
      <span className="absolute -top-2 -right-2 flex opacity-0 transition-opacity duration-150 ease-out-strong group-focus-within/file:opacity-100 group-hover/file:opacity-100 pointer-coarse:opacity-100">
        <Button
          variant="secondary"
          size="icon-2xs"
          shape="round"
          tabIndex={-1}
          aria-label={`Remove file ${file.number}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onRemoveFile(id)}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </span>
    </span>
  );
}
