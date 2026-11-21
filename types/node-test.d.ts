/** Ambient modules so checkJs can type the Node test files without @types/node. */

declare module "node:test" {
  function test(name: string, fn: () => void | Promise<void>): void;
  export default test;
}

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}
