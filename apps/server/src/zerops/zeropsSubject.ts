export const ZEROPS_SUBJECT_PREFIX = "zerops-user:";

/** The Zerops user behind a connection; unrelated subjects remain distinct. */
export const zeropsUserIdOf = (subject: string): string =>
  subject.startsWith(ZEROPS_SUBJECT_PREFIX) ? subject.slice(ZEROPS_SUBJECT_PREFIX.length) : subject;
