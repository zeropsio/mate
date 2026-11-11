import * as Tracer from "effect/Tracer";

export interface SqlStatementCounter {
  readonly tracer: Tracer.Tracer;
  /** Statements executed so far. Read before and after a phase and subtract. */
  readonly count: () => number;
}

/** The attribute the Effect SQL client sets on a statement's span, and on no other. */
const SQL_STATEMENT_ATTRIBUTE = "effect.sql.method";

/**
 * Counts the spans the Effect SQL client opens once per statement. They carry the client's own
 * name (`sqlite` here), so a statement is told by its `effect.sql.method` attribute; a
 * transaction's BEGIN and COMMIT spans carry none and are not statements. Spans behave exactly as
 * with the native tracer. Install the same counter on every runtime under test, otherwise
 * statements run by background reactors and statements run by request handlers land in different
 * counters.
 */
export function makeSqlStatementCounter(): SqlStatementCounter {
  let statements = 0;
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      const attribute = span.attribute.bind(span);
      span.attribute = (key, value) => {
        if (key === SQL_STATEMENT_ATTRIBUTE) statements += 1;
        attribute(key, value);
      };
      return span;
    },
  });
  return { tracer, count: () => statements };
}
