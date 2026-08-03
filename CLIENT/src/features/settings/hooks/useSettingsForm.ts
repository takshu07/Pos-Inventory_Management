/**
 * useSettingsForm — the shared editing engine behind every settings screen.
 *
 * WHAT IT SOLVES
 * --------------
 * Settings forms all need the same six behaviours, and writing them per screen
 * is how three screens end up with three subtly different dirty-checks:
 *
 *   1. Load server state into a local draft, and re-sync when the server state
 *      changes underneath (another save, a refetch).
 *   2. Track which fields are dirty — per field, so the PATCH carries only what
 *      actually changed.
 *   3. Validate locally before sending, so obvious mistakes never round-trip.
 *   4. Send a minimal patch with `expectedVersion` for conflict detection.
 *   5. Reset / discard.
 *   6. Warn before leaving with unsaved changes.
 *
 * Receipt & Invoice Settings and Barcode Settings are expected to use this hook
 * with a different `blocks` argument and nothing else changed.
 *
 * WHY A DRAFT RATHER THAN WRITING STRAIGHT THROUGH
 * -----------------------------------------------
 * These fields are business rules, not preferences. Typing "1" on the way to
 * "15" in the manager discount limit must not momentarily save a 1% cap, and a
 * half-typed GST number must never reach the server. Edits therefore accumulate
 * locally and commit on an explicit Save. Screens that genuinely want
 * write-on-change (a single toggle) can call `saveField`, which patches that one
 * key immediately without touching the rest of the draft.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSettings, useUpdateSettings } from "./useSettings";
import type { ConfigBlockName, FullConfiguration, SettingsPatch } from "../types";

/** A validation problem, keyed by `"blockName.fieldName"`. */
export type FieldErrors = Record<string, string>;

/**
 * Validates a draft. Returns problems keyed by `"block.field"` so the input that
 * caused each one can render it inline.
 */
export type SettingsValidator = (draft: FullConfiguration) => FieldErrors;

interface UseSettingsFormOptions {
  /**
   * Which config blocks this screen owns.
   *
   * Only these are diffed and sent, so two settings screens open in two tabs
   * cannot clobber each other's fields — each PATCH names only its own blocks.
   */
  blocks: readonly ConfigBlockName[];
  /** Whether the screen edits the top-level scalars (storeName/currency/timeZone). */
  includeScalars?: boolean;
  validate?: SettingsValidator;
}

export function useSettingsForm({
  blocks,
  includeScalars = false,
  validate,
}: UseSettingsFormOptions) {
  const query = useSettings();
  const mutation = useUpdateSettings();
  const server = query.data;

  const [draft, setDraft] = useState<FullConfiguration | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  /** Fields the user has interacted with — errors stay hidden until then. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  /**
   * The server version the draft was seeded from.
   *
   * Held in a ref rather than derived from `server.version` at save time: if a
   * background refetch bumps the version while the form sits open with unsaved
   * edits, saving must still be judged against what the user actually saw, which
   * is what makes the 409 fire instead of silently overwriting.
   */
  const baseVersion = useRef<number | null>(null);

  // ── Seed and re-sync ──────────────────────────────────────────────────────
  // Re-seeds only when the server's version actually changes, so an unrelated
  // refetch that returns identical data does not wipe in-progress edits.
  useEffect(() => {
    if (!server) return;
    if (baseVersion.current === server.version) return;

    setDraft(server);
    setErrors({});
    setTouched({});
    baseVersion.current = server.version;
  }, [server]);

  // ── Field mutation ────────────────────────────────────────────────────────

  const setField = useCallback(
    <B extends ConfigBlockName, K extends keyof FullConfiguration[B]>(
      block: B,
      field: K,
      value: FullConfiguration[B][K]
    ) => {
      setDraft((prev) =>
        prev ? { ...prev, [block]: { ...prev[block], [field]: value } } : prev
      );
      setTouched((prev) => ({ ...prev, [`${block}.${String(field)}`]: true }));
    },
    []
  );

  /** For the three top-level columns, which live outside any block. */
  const setScalar = useCallback(
    (field: "storeName" | "currency" | "timeZone", value: string) => {
      setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
      setTouched((prev) => ({ ...prev, [field]: true }));
    },
    []
  );

  // ── Diffing ───────────────────────────────────────────────────────────────

  /**
   * The minimal patch: only fields whose value differs from the server's.
   *
   * Sending only changed keys is what keeps the audit log meaningful — a full
   * block would record every field as "changed" on every save, so nobody could
   * later tell who actually altered the tax rate.
   */
  const patch = useMemo<SettingsPatch>(() => {
    if (!draft || !server) return {};
    const result: SettingsPatch = {};

    if (includeScalars) {
      if (draft.storeName !== server.storeName) result.storeName = draft.storeName;
      if (draft.currency !== server.currency) result.currency = draft.currency;
      if (draft.timeZone !== server.timeZone) result.timeZone = draft.timeZone;
    }

    for (const block of blocks) {
      // The config blocks are interface types without index signatures, so a
      // direct cast is rejected; going through `unknown` is the sanctioned way
      // to iterate them generically. Safe here because every block IS a plain
      // object of scalars and arrays — see the types module.
      const draftBlock = draft[block] as unknown as Record<string, unknown>;
      const serverBlock = server[block] as unknown as Record<string, unknown>;
      const blockPatch: Record<string, unknown> = {};

      for (const key of Object.keys(draftBlock)) {
        if (!isEqual(draftBlock[key], serverBlock[key])) {
          blockPatch[key] = draftBlock[key];
        }
      }

      if (Object.keys(blockPatch).length > 0) {
        (result as Record<string, unknown>)[block] = blockPatch;
      }
    }

    return result;
  }, [draft, server, blocks, includeScalars]);

  const isDirty = Object.keys(patch).length > 0;

  /** True when this exact field differs from the saved value — drives the "changed" dot. */
  const isFieldDirty = useCallback(
    (block: ConfigBlockName, field: string): boolean => {
      if (!draft || !server) return false;
      return !isEqual(
        (draft[block] as unknown as Record<string, unknown>)[field],
        (server[block] as unknown as Record<string, unknown>)[field]
      );
    },
    [draft, server]
  );

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft || !isDirty) return false;

    const problems = validate?.(draft) ?? {};
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      // Reveal every problem at once — validating only touched fields would hide
      // errors in sections the user never opened but is nonetheless saving.
      setTouched(
        Object.fromEntries(Object.keys(problems).map((k) => [k, true]))
      );
      return false;
    }

    setErrors({});

    const payload: SettingsPatch = { ...patch };
    if (baseVersion.current !== null) payload.expectedVersion = baseVersion.current;

    try {
      const fresh = await mutation.mutateAsync(payload);
      // Adopt the server's post-merge state so normalisation it applied
      // (uppercased currency, trimmed text) is visible immediately.
      setDraft(fresh);
      baseVersion.current = fresh.version;
      setTouched({});
      return true;
    } catch {
      // useUpdateSettings already surfaced the reason and rolled the cache back.
      return false;
    }
  }, [draft, isDirty, patch, validate, mutation]);

  /**
   * Immediately persists ONE field, bypassing the draft/Save cycle.
   *
   * For controls where the interaction IS the decision — a toggle, a select —
   * and holding the change hostage to a Save button would feel broken. Still
   * version-checked, so it cannot silently overwrite a concurrent edit.
   */
  const saveField = useCallback(
    async <B extends ConfigBlockName, K extends keyof FullConfiguration[B]>(
      block: B,
      field: K,
      value: FullConfiguration[B][K]
    ): Promise<boolean> => {
      setField(block, field, value);
      const payload: SettingsPatch = { [block]: { [field]: value } } as SettingsPatch;
      if (baseVersion.current !== null) payload.expectedVersion = baseVersion.current;

      try {
        const fresh = await mutation.mutateAsync(payload);
        setDraft(fresh);
        baseVersion.current = fresh.version;
        return true;
      } catch {
        // Roll the local draft back to the server's value; the cache rollback in
        // useUpdateSettings does not reach this component's own draft state.
        setDraft((prev) =>
          prev && server ? { ...prev, [block]: server[block] } : prev
        );
        return false;
      }
    },
    [mutation, server, setField]
  );

  const reset = useCallback(() => {
    if (!server) return;
    setDraft(server);
    setErrors({});
    setTouched({});
  }, [server]);

  // ── Unsaved-changes guard ─────────────────────────────────────────────────
  // Covers reload / tab-close / external navigation. In-app navigation is
  // guarded separately by the screen, which can show a real dialog.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required by Chrome to actually show the native prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  /** Only show a field's error once it has been touched or a save was attempted. */
  const errorFor = useCallback(
    (path: string): string | undefined =>
      touched[path] ? errors[path] : undefined,
    [errors, touched]
  );

  return {
    draft,
    server,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isSaving: mutation.isPending,
    isDirty,
    isFieldDirty,
    patch,
    errors,
    errorFor,
    setField,
    setScalar,
    save,
    saveField,
    reset,
  };
}

/**
 * Value equality for config fields.
 *
 * Handles the array case (`defaultExchangeReasons`) explicitly; everything else
 * in every block is a scalar, so `===` is correct and a deep-equality library
 * would be doing nothing but costing bundle size.
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}
