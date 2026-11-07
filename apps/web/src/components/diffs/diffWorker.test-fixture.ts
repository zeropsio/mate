// Vitest's Node runner cannot execute Vite's ?worker import; use the test's Worker constructor.
export default function testWorker() {
  return new Worker("worker.js");
}
