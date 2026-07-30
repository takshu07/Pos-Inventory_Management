/**
 * LabelTemplateSelector — template picker.
 *
 * Templates are fetched from the OWNER-scoped endpoint, which non-owners cannot
 * read. That is deliberate: a manager or cashier prints with the CONFIGURED
 * default rather than choosing a layout. When the list is unavailable the
 * component degrades to a disabled "Default template" control instead of an
 * error, so a cashier's print dialog still works.
 */

import { Select, type SelectOption } from "@/components/ui";

import { useLabelTemplates } from "../hooks/useLabels";
import type { LabelTemplateKind } from "../api/labelApi";

export interface LabelTemplateSelectorProps {
  value: string | null | undefined;
  onChange: (templateId: string | null) => void;
  /** Restrict to one kind (e.g. only shelf labels). */
  kind?: LabelTemplateKind;
  label?: string;
  /** False for roles that may not read the template list. */
  canReadTemplates?: boolean;
  disabled?: boolean;
}

export function LabelTemplateSelector({
  value,
  onChange,
  kind,
  label = "Label template",
  canReadTemplates = true,
  disabled,
}: LabelTemplateSelectorProps) {
  const { data: templates, isLoading } = useLabelTemplates(
    { ...(kind && { kind }) },
    { enabled: canReadTemplates }
  );

  if (!canReadTemplates) {
    return (
      <Select
        label={label}
        value=""
        disabled
        options={[{ value: "", label: "Default template" }]}
        hint="Your role uses the store's default label template."
        onChange={() => {}}
      />
    );
  }

  const options: SelectOption[] = [
    { value: "", label: isLoading ? "Loading templates…" : "Use default template" },
    ...(templates ?? []).map((template) => ({
      value: template.id,
      label: `${template.name} · ${Number(template.widthMm)}×${Number(template.heightMm)}mm`,
    })),
  ];

  return (
    <Select
      label={label}
      value={value ?? ""}
      options={options}
      disabled={disabled || isLoading}
      onChange={(event) => onChange(event.target.value || null)}
    />
  );
}
