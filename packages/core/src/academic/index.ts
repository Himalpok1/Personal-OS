// Barrel for the `./academic/*` subpath only -- deliberately NOT re-exported
// from packages/core's root barrel (see derive.ts's module comment).
export * from "./derive.js";
export * from "./buckets.js";
export * from "./current-term.js";
export * from "./urgency.js";
export * from "./workload.js";
export * from "./grade-summary.js";
