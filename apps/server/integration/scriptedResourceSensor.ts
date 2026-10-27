// @effect-diagnostics nodeBuiltinImport:off -- authored raw kernel evidence, never derived health.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
/** Own one container's raw sensor files. The real collector watches, reads and derives its verdict. */
export async function scriptedResourceSensor() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scripted-cgroup-"));
  const write = async (files: Readonly<Record<string, string>>) => {
    for (const [file, text] of Object.entries(files)) {
      if (!/^[a-z.]+$/.test(file)) throw new Error(`Not a kernel file: ${file}`);
      await NodeFSP.writeFile(NodePath.join(directory, file), text);
    }
  };
  await write({
    "memory.current": "268435456",
    "memory.high": "max",
    "memory.max": "2147483648",
    "memory.events": "high 0\nmax 0\noom 0\noom_kill 0\n",
    "memory.swap.current": "0",
    "memory.swap.max": "0",
    "memory.pressure":
      "some avg10=0 avg60=0 avg300=0 total=0\nfull avg10=0 avg60=0 avg300=0 total=0\n",
    "pids.current": "136",
    "pids.max": "2000",
    "io.pressure": "some avg10=0 avg60=0 avg300=0 total=0\nfull avg10=0 avg60=0 avg300=0 total=0\n",
  });
  return {
    directory,
    write,
    remove: () => NodeFSP.rm(directory, { recursive: true, force: true }),
  };
}
