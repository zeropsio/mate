/**
 * The model-based tests' explorer (DESIGN §11.3): every event sequence from each root to `depth`,
 * breadth first. A state is expanded once, at the shallowest depth that reaches it, identified by
 * its canonical `key`; `check` runs on every transition, also on one into a state already seen. A
 * state reached at the last depth is never expanded, and neither it nor a step that returns the
 * very state it was given is keyed.
 *
 * `key` decides the cost and the soundness: two states may share a key only when every event
 * sequence from one checks exactly as it does from the other, e.g. times relative to now and
 * counters relative to the next one.
 */
export interface Exploration<State, Event, Result extends { readonly state: State }> {
  readonly roots: ReadonlyArray<State>;
  readonly depth: number;
  /** The events the model may send next; they may depend on the state. */
  readonly events: (state: State) => Iterable<Event>;
  readonly step: (state: State, event: Event) => Result;
  readonly key: (state: State) => string;
  /** Every broken invariant of one transition, as readable strings; empty when all hold. */
  readonly check: (before: State, event: Event, result: Result) => ReadonlyArray<string>;
}

export interface ExplorationReport {
  readonly transitions: number;
  /** Distinct states whose events were sent, the roots' included. */
  readonly expanded: number;
  /**
   * The first violating transition's violations, each followed by the events that reached it, as
   * JSON.
   */
  readonly violations: ReadonlyArray<string>;
}

interface Node<State, Event> {
  readonly state: State;
  readonly parent: Node<State, Event> | null;
  readonly event: Event | null;
}

export function explore<State, Event, Result extends { readonly state: State }>(
  exploration: Exploration<State, Event, Result>,
): ExplorationReport {
  const seen = new Set<string>();
  let layer: Array<Node<State, Event>> = [];
  for (const state of exploration.roots) {
    const key = exploration.key(state);
    if (seen.has(key)) continue;
    seen.add(key);
    layer.push({ state, parent: null, event: null });
  }
  let transitions = 0;
  let expanded = 0;
  for (let depth = 1; depth <= exploration.depth; depth += 1) {
    const last = depth === exploration.depth;
    const next: Array<Node<State, Event>> = [];
    for (const node of layer) {
      expanded += 1;
      for (const event of exploration.events(node.state)) {
        const result = exploration.step(node.state, event);
        transitions += 1;
        const found = exploration.check(node.state, event, result);
        if (found.length > 0) {
          const trail: Array<string> = [JSON.stringify(event)];
          for (let at = node; at.event !== null && at.parent !== null; at = at.parent) {
            trail.unshift(JSON.stringify(at.event));
          }
          const after = `\n  after ${trail.join("\n  ")}`;
          return {
            transitions,
            expanded,
            violations: found.map((violation) => violation + after),
          };
        }
        if (last || result.state === node.state) continue;
        const key = exploration.key(result.state);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ state: result.state, parent: node, event });
      }
    }
    layer = next;
  }
  return { transitions, expanded, violations: [] };
}
