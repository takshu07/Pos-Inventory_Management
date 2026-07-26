import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import { useWizard } from "../WizardContext";
import { StepShell, FieldGroup } from "../components/StepShell";
import { useSizeOptions, useColorOptions } from "../../hooks/useOwnerProducts";

/**
 * Step 3 — Product Attributes. Define the SIZE and COLOR value sets that become
 * variant generators in Step 4. Existing sizes/colors are offered as quick-add
 * chips (from the lookup endpoints); new ones can be typed inline and will be
 * created on the server at submit time.
 */
export function AttributesStep() {
  const { state, dispatch } = useWizard();
  const { data: sizeOptions = [] } = useSizeOptions();
  const { data: colorOptions = [] } = useColorOptions();

  const setSizes = (sizes: string[]) =>
    dispatch({ type: "SET_ATTRIBUTES", attributes: { ...state.attributes, sizes } });
  const setColors = (colors: { name: string; hex?: string }[]) =>
    dispatch({ type: "SET_ATTRIBUTES", attributes: { ...state.attributes, colors } });

  const addSize = (name: string) => {
    const n = name.trim();
    if (!n || state.attributes.sizes.some((s) => s.toLowerCase() === n.toLowerCase())) return;
    setSizes([...state.attributes.sizes, n]);
  };
  const removeSize = (name: string) =>
    setSizes(state.attributes.sizes.filter((s) => s !== name));

  const addColor = (name: string, hex?: string) => {
    const n = name.trim();
    if (!n || state.attributes.colors.some((c) => c.name.toLowerCase() === n.toLowerCase())) return;
    setColors([...state.attributes.colors, hex ? { name: n, hex } : { name: n }]);
  };
  const removeColor = (name: string) =>
    setColors(state.attributes.colors.filter((c) => c.name !== name));

  const totalCombos = state.attributes.sizes.length * state.attributes.colors.length;

  return (
    <StepShell
      title="Product Attributes"
      description="Define the sizes and colors this product comes in. These generate the variants."
    >
      <FieldGroup columns={2}>
        <ChipEditor
          title="Sizes"
          values={state.attributes.sizes.map((s) => ({ label: s }))}
          suggestions={sizeOptions.map((s) => s.name)}
          onAdd={addSize}
          onRemove={removeSize}
          placeholder="e.g. XL"
        />
        <ColorEditor
          colors={state.attributes.colors}
          suggestions={colorOptions.map((c) => ({ name: c.name, hex: c.hexCode ?? undefined }))}
          onAdd={addColor}
          onRemove={removeColor}
        />
      </FieldGroup>

      <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
        {totalCombos > 0 ? (
          <>
            This will generate <span className="font-semibold">{totalCombos}</span> variant
            {totalCombos === 1 ? "" : "s"} ({state.attributes.colors.length} color
            {state.attributes.colors.length === 1 ? "" : "s"} ×{" "}
            {state.attributes.sizes.length} size
            {state.attributes.sizes.length === 1 ? "" : "s"}). Continue to generate them.
          </>
        ) : (
          <span className="text-muted-foreground">
            Add at least one size and one color to generate variants.
          </span>
        )}
      </div>
    </StepShell>
  );
}

function ChipEditor({
  title,
  values,
  suggestions,
  onAdd,
  onRemove,
  placeholder,
}: {
  title: string;
  values: { label: string }[];
  suggestions: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const current = new Set(values.map((v) => v.label.toLowerCase()));
  const remainingSuggestions = suggestions.filter((s) => !current.has(s.toLowerCase()));

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <div className="flex items-end gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd(input);
              setInput("");
            }
          }}
          placeholder={placeholder}
        />
        <Button
          variant="outline"
          onClick={() => {
            onAdd(input);
            setInput("");
          }}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          Add
        </Button>
      </div>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Chip key={v.label} label={v.label} onRemove={() => onRemove(v.label)} />
          ))}
        </div>
      )}

      {remainingSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">Quick add:</span>
          {remainingSuggestions.slice(0, 12).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onAdd(s)}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorEditor({
  colors,
  suggestions,
  onAdd,
  onRemove,
}: {
  colors: { name: string; hex?: string }[];
  suggestions: { name: string; hex?: string }[];
  onAdd: (name: string, hex?: string) => void;
  onRemove: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#000000");
  const current = new Set(colors.map((c) => c.name.toLowerCase()));
  const remaining = suggestions.filter((s) => !current.has(s.name.toLowerCase()));

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        Colors
      </h3>
      <div className="flex items-end gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-input bg-background"
          aria-label="Color swatch"
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd(name, hex);
              setName("");
            }
          }}
          placeholder="e.g. Navy"
        />
        <Button
          variant="outline"
          onClick={() => {
            onAdd(name, hex);
            setName("");
          }}
          leftIcon={<Plus className="h-4 w-4" />}
        >
          Add
        </Button>
      </div>

      {colors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {colors.map((c) => (
            <Chip
              key={c.name}
              label={c.name}
              swatch={c.hex}
              onRemove={() => onRemove(c.name)}
            />
          ))}
        </div>
      )}

      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">Quick add:</span>
          {remaining.slice(0, 12).map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => onAdd(s.name, s.hex)}
              className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              {s.hex && (
                <span
                  className="h-2.5 w-2.5 rounded-full border border-border"
                  style={{ backgroundColor: s.hex }}
                />
              )}
              + {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  swatch,
  onRemove,
}: {
  label: string;
  swatch?: string;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-sm"
      )}
    >
      {swatch && (
        <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: swatch }} />
      )}
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
