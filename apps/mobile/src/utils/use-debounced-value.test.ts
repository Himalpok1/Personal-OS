import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same minimal call-order-indexed hooks harness as use-busy-press.test.ts and
// use-reminder-reconciliation.test.ts, for the same reason: this repo has no
// React renderer installed for tests, the hook has no JSX surface, and its
// call order never varies across renders. useEffect is modelled the way the
// reconciliation test models it -- run on first render and whenever deps
// change, calling the previous cleanup first -- which is exactly the part of
// React's contract a debounce depends on.
const hooksHarness = vi.hoisted(() => {
  const values = new Map<number, unknown>();
  const effectDeps = new Map<number, readonly unknown[] | undefined>();
  const effectCleanups = new Map<number, (() => void) | undefined>();
  let index = 0;

  function reset(): void {
    for (const cleanup of effectCleanups.values()) cleanup?.();
    values.clear();
    effectDeps.clear();
    effectCleanups.clear();
    index = 0;
  }

  function beginRender(): void {
    index = 0;
  }

  function useState<T>(initial: T): [T, (updater: T | ((prev: T) => T)) => void] {
    const idx = index++;
    if (!values.has(idx)) values.set(idx, initial);
    const setState = (updater: T | ((prev: T) => T)): void => {
      const prev = values.get(idx) as T;
      values.set(idx, typeof updater === "function" ? (updater as (prev: T) => T)(prev) : updater);
    };
    return [values.get(idx) as T, setState];
  }

  function depsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  }

  function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
    const idx = index++;
    const prevDeps = effectDeps.get(idx);
    const changed =
      !effectDeps.has(idx) ||
      deps === undefined ||
      prevDeps === undefined ||
      !depsEqual(deps, prevDeps);
    effectDeps.set(idx, deps);
    if (!changed) return;
    effectCleanups.get(idx)?.();
    const cleanup = effect();
    effectCleanups.set(idx, typeof cleanup === "function" ? cleanup : undefined);
  }

  return { reset, beginRender, useState, useEffect };
});

vi.mock("react", () => ({
  useState: hooksHarness.useState,
  useEffect: hooksHarness.useEffect,
}));

// Must import after vi.mock("react").
// eslint-disable-next-line import/first
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "./use-debounced-value";

function render(value: string, delayMs = SEARCH_DEBOUNCE_MS): string {
  hooksHarness.beginRender();
  // The harness above IS the "renderer" here.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useDebouncedValue(value, delayMs);
}

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hooksHarness.reset();
  });
  afterEach(() => {
    hooksHarness.reset();
    vi.useRealTimers();
  });

  it("returns the initial value immediately -- no blank first 250 ms", () => {
    expect(render("rent")).toBe("rent");
  });

  it("holds the previous value until the new one has settled for the delay", () => {
    render("r");
    expect(render("re")).toBe("r");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(render("re")).toBe("r");
    vi.advanceTimersByTime(1);
    expect(render("re")).toBe("re");
  });

  it("restarts the clock on every change, so rapid typing yields ONE settled value", () => {
    render("");
    for (const typed of ["r", "re", "ren", "rent"]) {
      render(typed);
      vi.advanceTimersByTime(100);
    }
    // 400 ms of wall time have passed but no single value has been stable for
    // 250 ms yet; the debounced value is still the initial one.
    expect(render("rent")).toBe("");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(render("rent")).toBe("rent");
  });

  it("pins the search settle time at 250 ms", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(250);
  });

  it("clears its timer on cleanup, so an unmount mid-typing sets nothing later", () => {
    render("a");
    render("ab");
    expect(vi.getTimerCount()).toBe(1);
    hooksHarness.reset(); // runs every pending cleanup, as an unmount would
    expect(vi.getTimerCount()).toBe(0);
  });
});
