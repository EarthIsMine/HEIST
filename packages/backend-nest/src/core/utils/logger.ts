export function log(prefix: string, ...args: unknown[]) {
  console.log(`[${prefix}]`, ...args);
}
