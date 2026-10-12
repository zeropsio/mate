/**
 * Reads the Mac view helper's stream (`macViewScript.ts`, "Wire"): JSON header
 * lines, each followed by the image bytes it announces.
 *
 * @module macViewWire
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const Bounds = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const Header = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("frame"),
    size: Schema.Int,
    mimeType: Schema.String,
    width: Schema.Number,
    height: Schema.Number,
    bounds: Bounds,
    inUse: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("state"),
    status: Schema.Literals(["no-app", "no-window", "no-capture"]),
    inUse: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("tick"), inUse: Schema.Boolean }),
]);
type Header = typeof Header.Type;

const decodeHeader = Schema.decodeUnknownOption(Schema.fromJsonString(Header));

export type MacViewMessage =
  | (Extract<Header, { readonly type: "frame" }> & { readonly bytes: Uint8Array })
  | Exclude<Header, { readonly type: "frame" }>;

/** A header line longer than this is not the helper talking (an error page, a shell's noise). */
const MAX_HEADER_BYTES = 4096;
/** A frame larger than this is not one the helper sends (it scales captures down to 1600 px). */
export const MAX_MAC_FRAME_BYTES = 16 * 1024 * 1024;

const NEWLINE = 0x0a;

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  if (left.length === 0) return right;
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
};

/**
 * An incremental reader: feed it stdout chunks as they come, take whole
 * messages out. Anything that is not the helper's wire makes it `broken`, and
 * the caller drops the connection.
 */
export const makeMacViewParser = () => {
  let buffer: Uint8Array = new Uint8Array(0);
  let pending: Extract<Header, { readonly type: "frame" }> | undefined;
  let broken = false;
  const decoder = new TextDecoder();
  return {
    get broken() {
      return broken;
    },
    push(chunk: Uint8Array): ReadonlyArray<MacViewMessage> {
      if (broken) return [];
      buffer = concat(buffer, chunk);
      const messages: MacViewMessage[] = [];
      while (true) {
        if (pending !== undefined) {
          if (buffer.length < pending.size) break;
          messages.push({ ...pending, bytes: buffer.slice(0, pending.size) });
          buffer = buffer.slice(pending.size);
          pending = undefined;
          continue;
        }
        const end = buffer.indexOf(NEWLINE);
        if (end < 0) {
          if (buffer.length > MAX_HEADER_BYTES) broken = true;
          break;
        }
        const header = Option.getOrUndefined(decodeHeader(decoder.decode(buffer.slice(0, end))));
        buffer = buffer.slice(end + 1);
        if (
          header === undefined ||
          (header.type === "frame" && (header.size <= 0 || header.size > MAX_MAC_FRAME_BYTES))
        ) {
          broken = true;
          break;
        }
        if (header.type === "frame") pending = header;
        else messages.push(header);
      }
      return broken ? [] : messages;
    },
  };
};
