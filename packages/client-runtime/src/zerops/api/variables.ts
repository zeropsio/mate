/** A variable write's body as the Zerops REST API takes it:
 * one resource of `../api.ts`'s client. */

/** One vault write's body: `sensitive` is always said (a write without it turns a value plain). */
export interface ZeropsVariableWrite {
  readonly key: string;
  readonly content: string;
  readonly sensitive: boolean;
}
