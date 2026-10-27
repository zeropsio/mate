/** Fake time advances only when its driver says so; pending HTTP work is released by advance. */
export class FakeClock {
  now = 0;
  private wall: { at: number; elapsed: number } | undefined;
  /** Live wall time until a driver/page clock pins it; latency/credential time stays independent. */
  currentTimeMillis() {
    return this.wall ? this.wall.at + this.now - this.wall.elapsed : Date.now() + this.now;
  }
  setTime(timestamp: number) {
    if (!Number.isFinite(timestamp)) throw new Error("Clock timestamp must be finite");
    this.wall = { at: timestamp, elapsed: this.now };
  }
  private pending: { at: number; resolve: () => void }[] = [];
  wait(ms: number) {
    return new Promise<void>((resolve) => this.pending.push({ at: this.now + ms, resolve }));
  }
  advance(ms: number) {
    this.now += ms;
    const due = this.pending.filter((task) => task.at <= this.now);
    this.pending = this.pending.filter((task) => task.at > this.now);
    for (const task of due) task.resolve();
  }
}
