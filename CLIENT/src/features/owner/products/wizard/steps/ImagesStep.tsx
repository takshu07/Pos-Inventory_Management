import { useState } from "react";
import { ImagePlus, X, Star, GripVertical, ImageOff } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { cn } from "@/utils/cn";
import { useWizard } from "../WizardContext";
import { StepShell } from "../components/StepShell";
import { clientId } from "../helpers";
import type { WizardImage } from "../types";

/**
 * Step 2 — Images. URL-based image management (the product model stores image
 * URLs). Supports: add by URL, drag-to-reorder, thumbnail (primary) selection,
 * per-image role tag (front/back/side/close-up/lifestyle), remove, duplicate
 * detection, and a hard cap of 10. The first image is the thumbnail.
 *
 * NOTE: direct file upload → CDN URL is a follow-up; the asset service stores
 * files privately without a public URL, so we take verified image URLs here.
 */

const ROLES: WizardImage["role"][] = ["front", "back", "side", "close-up", "lifestyle"];
const MAX = 10;

export function ImagesStep() {
  const { state, dispatch } = useWizard();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const images = state.images;

  const setImages = (next: WizardImage[]) => dispatch({ type: "PATCH", patch: { images: next } });

  const add = () => {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed);
    } catch {
      setError("Enter a valid image URL (https://…).");
      return;
    }
    if (images.length >= MAX) {
      setError(`Maximum ${MAX} images.`);
      return;
    }
    if (images.some((i) => i.url === trimmed)) {
      setError("That image has already been added.");
      return;
    }
    setImages([...images, { id: clientId("img"), url: trimmed }]);
    setUrl("");
  };

  const remove = (id: string) => setImages(images.filter((i) => i.id !== id));

  const makePrimary = (index: number) => {
    if (index === 0) return;
    const next = [...images];
    const [item] = next.splice(index, 1);
    next.unshift(item!);
    setImages(next);
  };

  const setRole = (id: string, role: WizardImage["role"]) =>
    setImages(images.map((i) => (i.id === id ? { ...i, role } : i)));

  const onDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    const next = [...images];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved!);
    setImages(next);
    setDragIndex(null);
  };

  return (
    <StepShell
      title="Images"
      description={`Add up to ${MAX} images. Drag to reorder — the first image is the thumbnail.`}
    >
      <div className="flex items-end gap-2">
        <Input
          label="Image URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="https://cdn.example.com/product-front.jpg"
          error={error ?? undefined}
        />
        <Button onClick={add} leftIcon={<ImagePlus className="h-4 w-4" />} disabled={images.length >= MAX}>
          Add
        </Button>
      </div>

      {images.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-14 text-muted-foreground">
          <ImageOff className="h-10 w-10" />
          <p className="text-sm">No images yet. Add an image URL above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {images.map((img, index) => (
            <div
              key={img.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(index)}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-shadow",
                index === 0 ? "border-primary ring-1 ring-primary" : "border-border",
                dragIndex === index && "opacity-50"
              )}
            >
              <div className="relative aspect-square bg-muted/20">
                <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                <div className="absolute left-1 top-1 flex items-center gap-1">
                  <span className="flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    <GripVertical className="h-3 w-3" /> {index + 1}
                  </span>
                  {index === 0 && (
                    <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                      Thumbnail
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(img.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                  aria-label="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1 p-1.5">
                <select
                  value={img.role ?? ""}
                  onChange={(e) => setRole(img.id, (e.target.value || undefined) as WizardImage["role"])}
                  className="h-7 flex-1 rounded border border-input bg-background px-1 text-xs"
                >
                  <option value="">Tag…</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {index !== 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => makePrimary(index)}
                    aria-label="Set as thumbnail"
                    title="Set as thumbnail"
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {images.length}/{MAX} images. Products with photos sell noticeably better — front &amp; back at
        minimum are recommended.
      </p>
    </StepShell>
  );
}
