/**
 * `read`, once for each file: a draft saved again and again reads only the
 * files it has not read yet. A read that fails is tried again next time.
 */
export function readOncePerFile(
  read: (file: File) => Promise<string>,
): (file: File) => Promise<string> {
  const reads = new WeakMap<File, Promise<string>>();
  return (file) => {
    const known = reads.get(file);
    if (known) return known;
    const reading = read(file);
    reads.set(file, reading);
    reading.catch(() => reads.delete(file));
    return reading;
  };
}
