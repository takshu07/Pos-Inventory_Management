// =============================================================================
// CATEGORY VALIDATION — regression tests
//
// These exist because of a live bug: the client sent `null` for blank optional
// fields on CREATE, but `createSchema` accepts only `string | undefined`, so
// every "New category" submit with an empty description / keywords / image
// 400'd with "Validation failed" — which is the default create.
//
// The create/update asymmetry is DELIBERATE and is what these tests pin down:
//   • CREATE takes `undefined` (omit the key). There is nothing to clear on a
//     row that does not exist yet, so accepting `null` too would make
//     `imageUrl: null` and `imageUrl: ""` two spellings of the same thing.
//   • UPDATE takes `null` as the explicit "clear this field" sentinel, which is
//     the only way a PATCH can distinguish "erase it" from "leave it alone".
//
// Changing either side to match the other re-opens the bug from one direction
// or breaks field-clearing from the other. See docs/MODULE_STATUS.md §3.
// =============================================================================

import { describe, expect, it } from "vitest";

import { categoryValidation } from "../category.validation";

const create = categoryValidation.create;
const update = categoryValidation.update;

// =============================================================================
// CREATE — the shape the "New category" drawer actually submits
// =============================================================================

describe("categoryValidation.create", () => {
  it("accepts a name-only payload, defaulting status and displayOrder", () => {
    const result = create.safeParse({ name: "tshirts" });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.status).toBe("ACTIVE");
    expect(result.data.displayOrder).toBe(0);
  });

  it("accepts the exact drawer payload when optional fields are left blank", () => {
    // Reproduces the reported failure: name + keywords typed, everything else
    // untouched. Blank optionals must be OMITTED, never sent as null.
    const result = create.safeParse({
      name: "tshirts",
      status: "ACTIVE",
      searchKeywords: "tshirts",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.searchKeywords).toBe("tshirts");
    expect(result.data.description).toBeUndefined();
    expect(result.data.imageUrl).toBeUndefined();
  });

  it("REJECTS null for optional fields — the client must omit them instead", () => {
    // This is the bug, pinned: if this ever starts passing, the create contract
    // was widened and the "" vs null ambiguity is back.
    const result = create.safeParse({
      name: "tshirts",
      description: null,
      searchKeywords: null,
      imageUrl: null,
      status: "ACTIVE",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path[0]).sort()).toEqual([
      "description",
      "imageUrl",
      "searchKeywords",
    ]);
  });

  it("normalises keywords: trimmed, lower-cased and de-duplicated", () => {
    const result = create.safeParse({
      name: "tshirts",
      searchKeywords: " Tees , T-Shirt ,tees,, HALF sleeve ",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.searchKeywords).toBe("tees, t-shirt, half sleeve");
  });

  it("enforces the 2–50 character name bound the form mirrors", () => {
    expect(create.safeParse({ name: "a" }).success).toBe(false);
    expect(create.safeParse({ name: "a".repeat(51) }).success).toBe(false);
    expect(create.safeParse({ name: "ab" }).success).toBe(true);
  });

  it("accepts a relative asset path as well as an absolute URL", () => {
    // The asset service returns paths like /api/v1/assets/<id>, which a plain
    // z.string().url() would reject.
    expect(create.safeParse({ name: "tshirts", imageUrl: "/api/v1/assets/x" }).success).toBe(true);
    expect(create.safeParse({ name: "tshirts", imageUrl: "https://cdn.example/x.png" }).success).toBe(true);
    expect(create.safeParse({ name: "tshirts", imageUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("rejects an unknown status rather than coercing it", () => {
    expect(create.safeParse({ name: "tshirts", status: "DELETED" }).success).toBe(false);
  });
});

// =============================================================================
// UPDATE — null is meaningful here, and must stay that way
// =============================================================================

describe("categoryValidation.update", () => {
  it("ACCEPTS null as the explicit clear-this-field sentinel", () => {
    const result = update.safeParse({
      description: null,
      searchKeywords: null,
      imageUrl: null,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.description).toBeNull();
    expect(result.data.imageUrl).toBeNull();
  });

  it("allows a single-field patch without requiring the rest", () => {
    expect(update.safeParse({ status: "ARCHIVED" }).success).toBe(true);
  });

  it("still enforces the name bound when name is the field being patched", () => {
    expect(update.safeParse({ name: "a" }).success).toBe(false);
  });
});
