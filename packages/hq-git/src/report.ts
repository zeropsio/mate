/** Incremental bounded report-status decoder; discard sideband progress and retain only ok refs. */
export class PushReport {
  readonly ok = new Set<string>();
  readonly requested: boolean;
  private readonly sideband: boolean;
  private outer: Buffer = Buffer.alloc(0);
  private inner: Buffer = Buffer.alloc(0);
  private valid = true;
  constructor(capabilities: ReadonlyArray<string>) {
    this.requested = capabilities.some((c) => c === "report-status" || c === "report-status-v2");
    this.sideband = capabilities.some((c) => c === "side-band" || c === "side-band-64k");
  }
  private packets(bytes: Buffer, outer: boolean): Buffer {
    let offset = 0;
    while (bytes.length - offset >= 4 && this.valid) {
      const header = bytes.subarray(offset, offset + 4).toString("ascii");
      const length = Number.parseInt(header, 16);
      if (!/^[0-9a-f]{4}$/i.test(header) || (length !== 0 && (length < 4 || length > 65520))) {
        this.valid = false;
        this.ok.clear();
        break;
      }
      if (length === 0) {
        offset += 4;
        continue;
      }
      if (bytes.length - offset < length) break;
      const payload = bytes.subarray(offset + 4, offset + length);
      offset += length;
      if (outer) {
        if (payload[0] === 1)
          this.inner = this.packets(Buffer.concat([this.inner, payload.subarray(1)]), false);
      } else {
        const match = /^ok ([^\0\r\n]+)\n?$/.exec(payload.toString());
        if (match) this.ok.add(match[1]!);
      }
    }
    return bytes.subarray(offset);
  }
  feed(bytes: Buffer): void {
    if (!this.requested || !this.valid) return;
    if (this.sideband) this.outer = this.packets(Buffer.concat([this.outer, bytes]), true);
    else this.inner = this.packets(Buffer.concat([this.inner, bytes]), false);
  }
}
