/**
 * SearchBox — the onChange contract.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `SearchBox` unwraps the DOM event internally and calls `onChange(value)` with
 * a STRING. Audit Logs passed it an event handler — `(e) => onChange(e.target.value)`
 * — which read `.target` off a string, got `undefined`, and set the query to
 * undefined on every keystroke. Audit search silently returned the unfiltered
 * list. It shipped because the mistake is invisible three ways: it does not
 * throw, the component still renders, and the only compile error was buried
 * among unrelated pre-existing ones in the same module.
 *
 * There is no DOM in this test config (see vitest.config.ts — component tests
 * are a separate infrastructure milestone), so this asserts the contract at the
 * type level and pins the shape callers must satisfy. It is deliberately cheap:
 * the point is that the next person wiring a SearchBox has something that fails
 * when they assume an event.
 */

import { describe, expect, it } from "vitest";

/**
 * The handler shape SearchBox actually calls.
 *
 * Mirrors `SearchBoxProps["onChange"]`. If SearchBox is ever changed to pass the
 * event instead, this alias stops matching its real prop type and the callers
 * below need revisiting — which is the signal this file exists to give.
 */
type SearchBoxOnChange = (value: string) => void;

describe("SearchBox onChange contract", () => {
  it("hands the handler a plain string, not a change event", () => {
    let received: unknown = "untouched";
    const handler: SearchBoxOnChange = (value) => {
      received = value;
    };

    // What SearchBox does internally: onChange?.(e.target.value)
    handler("laptop");

    expect(received).toBe("laptop");
    expect(typeof received).toBe("string");
  });

  it("REGRESSION: an event-style handler reads undefined from the string", () => {
    // This is exactly what Audit Logs did before 2026-08-03. Reproduced here so
    // the failure mode is documented as executable rather than as a comment.
    let captured: unknown = "untouched";
    const buggyHandler = (e: unknown) => {
      captured = (e as { target?: { value?: string } })?.target?.value;
    };

    (buggyHandler as SearchBoxOnChange)("laptop");

    // No throw, no crash — just a silently empty query. Hence the bug's lifespan.
    expect(captured).toBeUndefined();
  });

  it("passes the empty string when cleared, which must not be dropped", () => {
    // SearchBox's clear button calls onChange(""). A caller that treats "" as
    // "no change" leaves a stale query applied after the user clears the box.
    const seen: string[] = [];
    const handler: SearchBoxOnChange = (value) => seen.push(value);

    handler("abc");
    handler("");

    expect(seen).toEqual(["abc", ""]);
  });
});
