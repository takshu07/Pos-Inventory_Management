import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { CategoryImageUpload } from "./CategoryImageUpload";
import {
  EMPTY_CATEGORY_FORM,
  type CategoryFormValues,
  type CategoryRow,
  type CategoryStatus,
} from "../types";

/**
 * CategoryForm — create and edit.
 *
 * Client-side validation mirrors the server's Zod contract (2–50 char name,
 * ≤500 char description/keywords, valid status). It exists for fast feedback
 * ONLY — the server re-validates every field, and duplicate-name detection is
 * inherently server-side, so `serverError` is surfaced inline rather than
 * pretending the client can catch it.
 */

const NAME_MIN = 2;
const NAME_MAX = 50;
const DESC_MAX = 500;
const KEYWORDS_MAX = 500;

export interface CategoryFormErrors {
  name?: string;
  description?: string;
  searchKeywords?: string;
}

export function validateCategoryForm(
  values: CategoryFormValues,
  existingNames: string[] = []
): CategoryFormErrors {
  const errors: CategoryFormErrors = {};
  const name = values.name.trim();

  if (!name) {
    errors.name = "Category name is required.";
  } else if (name.length < NAME_MIN) {
    errors.name = `Name must be at least ${NAME_MIN} characters.`;
  } else if (name.length > NAME_MAX) {
    errors.name = `Name cannot exceed ${NAME_MAX} characters.`;
  } else if (existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
    // Matches the server's case-insensitive uniqueness rule.
    errors.name = "A category with this name already exists.";
  }

  if (values.description.length > DESC_MAX) {
    errors.description = `Description cannot exceed ${DESC_MAX} characters.`;
  }
  if (values.searchKeywords.length > KEYWORDS_MAX) {
    errors.searchKeywords = `Keywords cannot exceed ${KEYWORDS_MAX} characters.`;
  }

  return errors;
}

export function CategoryForm({
  initial,
  existingNames = [],
  submitting = false,
  serverError,
  onSubmit,
  onCancel,
}: {
  initial?: CategoryRow | null;
  /** Other categories' names, for instant duplicate feedback before submitting. */
  existingNames?: string[];
  submitting?: boolean;
  serverError?: string | null;
  onSubmit: (values: CategoryFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<CategoryFormValues>(EMPTY_CATEGORY_FORM);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Re-seed when the drawer is reused for a different category.
  useEffect(() => {
    setValues(
      initial
        ? {
            name: initial.name,
            description: initial.description ?? "",
            searchKeywords: initial.searchKeywords ?? "",
            status: initial.status,
            imageUrl: initial.imageUrl ?? "",
          }
        : EMPTY_CATEGORY_FORM
    );
    setTouched({});
  }, [initial]);

  // When editing, the category's own name must not count as a duplicate.
  const otherNames = useMemo(
    () => existingNames.filter((n) => n.toLowerCase() !== (initial?.name ?? "").toLowerCase()),
    [existingNames, initial]
  );

  const errors = useMemo(
    () => validateCategoryForm(values, otherNames),
    [values, otherNames]
  );
  const isValid = Object.keys(errors).length === 0;

  const set = <K extends keyof CategoryFormValues>(key: K, value: CategoryFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, description: true, searchKeywords: true });
    if (!isValid) return;
    onSubmit({ ...values, name: values.name.trim() });
  };

  const showError = (field: keyof CategoryFormErrors) =>
    touched[field] ? errors[field] : undefined;

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto">
        {serverError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <Input
          label="Name"
          required
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          error={showError("name")}
          placeholder="e.g. Men's Shirts"
          maxLength={NAME_MAX}
          autoFocus
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cat-description" className="text-sm font-medium leading-none">
            Description
          </label>
          <textarea
            id="cat-description"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, description: true }))}
            rows={3}
            maxLength={DESC_MAX}
            placeholder="What belongs in this category?"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-between text-xs">
            <span className="text-destructive">{showError("description") ?? ""}</span>
            <span className="text-muted-foreground">
              {values.description.length}/{DESC_MAX}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cat-keywords" className="text-sm font-medium leading-none">
            Search keywords
          </label>
          <Input
            id="cat-keywords"
            value={values.searchKeywords}
            onChange={(e) => set("searchKeywords", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, searchKeywords: true }))}
            error={showError("searchKeywords")}
            placeholder="tees, t-shirt, half sleeve"
            maxLength={KEYWORDS_MAX}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated synonyms. Staff can find this category by any of them.
          </p>
        </div>

        <Select
          label="Status"
          value={values.status}
          onChange={(e) => set("status", e.target.value as CategoryStatus)}
          options={[
            { value: "ACTIVE", label: "Active — visible across the catalog" },
            { value: "INACTIVE", label: "Inactive — hidden, products retained" },
            { value: "ARCHIVED", label: "Archived — retired from the catalog" },
          ]}
        />

        <CategoryImageUpload
          value={values.imageUrl}
          onChange={(url) => set("imageUrl", url)}
        />
      </div>

      <div className="mt-5 flex gap-2 border-t border-border pt-4">
        <Button type="submit" disabled={submitting || !isValid} className="flex-1">
          {submitting ? "Saving…" : initial ? "Save changes" : "Create category"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
