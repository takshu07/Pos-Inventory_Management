import { useCallback, useRef, useState } from "react";
import { ImagePlus, X, Star, GripVertical, Link2, Loader2, Upload } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api/axios";
import { cn } from "@/utils/cn";
import {
  MAX_BYTES,
  isImageFile,
  optimizeImage,
  uploadFilename,
} from "@/shared/images/optimizeImage";
import { useWizard } from "../WizardContext";
import { StepShell } from "../components/StepShell";
import { clientId } from "../helpers";
import type { WizardImage } from "../types";

/**
 * Step 2 — Images. Entirely OPTIONAL: a product can be created with none (the
 * validator raises a warning, never an error).
 *
 * Two ways in, because owners have photos in both places:
 *   • drag & drop / click-to-browse → uploaded to the asset module and stored as
 *     `/api/v1/assets/<id>/download`
 *   • paste a URL → stored verbatim, for images already on a CDN
 *
 * Uploads go to the shared asset module (`POST /assets/upload`) rather than a
 * product-specific endpoint — storage, validation and access control already
 * live there and must not be duplicated. This mirrors CategoryImageUpload; the
 * shared intake rules live in @/shared/images/optimizeImage.
 *
 * Also supports drag-to-reorder, thumbnail (primary) selection, per-image role
 * tag, remove, duplicate detection, and a hard cap of 10. The first image is the
 * thumbnail.
 */

const ROLES: WizardImage["role"][] = ["front", "back", "side", "close-up", "lifestyle"];
const MAX = 10;

export function ImagesStep() {
  const { state, dispatch } = useWizard();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [uploading, setUploading] = useState(0); // count of in-flight uploads
  const [showUrlInput, setShowUrlInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  /**
   * Upload one file and append it. Reads the CURRENT image list off the reducer
   * via a functional patch rather than the captured `images`, so several files
   * dropped at once cannot overwrite each other's appends.
   */
  const uploadOne = useCallback(
    async (file: File) => {
      if (!isImageFile(file)) {
        setError(`"${file.name}" isn't an image file.`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" is larger than 10 MB.`);
        return;
      }

      setUploading((n) => n + 1);
      try {
        let optimized: Blob;
        try {
          optimized = await optimizeImage(file);
        } catch {
          // The browser could not decode this image, so we can neither convert
          // nor display it. Say so plainly instead of uploading a file that
          // would render as a broken image everywhere.
          setError(
            `This browser can't read "${file.name}". Try saving it as JPG, PNG or WebP.`
          );
          return;
        }

        const form = new FormData();
        form.append("file", optimized, uploadFilename(file, optimized));
        form.append("ownerModule", "PRODUCT");
        // No ownerEntityId: the product does not exist yet at wizard time. The
        // asset is linked by URL when the product is created.
        //
        // PUBLIC because this image is rendered by <img src=…> in the grid,
        // tables and storefront. A browser image request carries no
        // Authorization header, so a PRIVATE asset would 401 and show as a
        // broken thumbnail. Catalog photos are non-sensitive; the assets that
        // need protecting (invoices, documents) keep the PRIVATE default.
        form.append("visibility", "PUBLIC");

        // The response interceptor returns the server's { success, message, data }
        // envelope, so the created asset is at `.data`.
        const res = await apiClient.post<{ id: string }>("/assets/upload", form);
        const assetId = (res.data as { id?: string })?.id;
        if (!assetId) throw new Error("Upload did not return an asset id.");

        const next: WizardImage = {
          id: clientId("img"),
          url: `/api/v1/assets/${assetId}/download`,
        };
        dispatch({
          type: "PATCH",
          patch: (prev) => ({
            images: prev.images.length >= MAX ? prev.images : [...prev.images, next],
          }),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : `Couldn't upload "${file.name}".`);
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [dispatch]
  );

  /** Accept a batch (drop or multi-select), trimmed to the remaining capacity. */
  const acceptFiles = useCallback(
    (fileList: FileList | null) => {
      setError(null);
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;

      const room = MAX - images.length - uploading;
      if (room <= 0) {
        setError(`Maximum ${MAX} images.`);
        return;
      }
      if (files.length > room) {
        setError(`Only ${room} more image${room === 1 ? "" : "s"} can be added — the rest were skipped.`);
      }
      files.slice(0, room).forEach((f) => void uploadOne(f));
    },
    [images.length, uploading, uploadOne]
  );

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

  const full = images.length + uploading >= MAX;

  return (
    <StepShell
      title="Images"
      description={`Optional — add up to ${MAX} images. Drag to reorder; the first image is the thumbnail.`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium leading-none">Product images</span>
        <button
          type="button"
          onClick={() => {
            setShowUrlInput((s) => !s);
            setError(null);
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Link2 className="h-3 w-3" />
          {showUrlInput ? "Upload instead" : "Add by URL"}
        </button>
      </div>

      {showUrlInput && (
        <div className="flex items-end gap-2">
          <Input
            label="Image URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="https://cdn.example.com/product-front.jpg"
          />
          <Button onClick={add} leftIcon={<ImagePlus className="h-4 w-4" />} disabled={full}>
            Add
          </Button>
        </div>
      )}

      {/*
        The dropzone doubles as the empty state, so there is no separate "no
        images yet" panel — the place you are told about is the place you drop.
      */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Add images"
        onClick={() => !full && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !full) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          // Only react to files — a card being reordered also fires dragover.
          if (dragIndex !== null) return;
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          if (dragIndex !== null) return;
          e.preventDefault();
          setDropActive(false);
          if (!full) acceptFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors",
          images.length === 0 ? "py-14" : "py-8",
          dropActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
          full && "cursor-not-allowed opacity-60"
        )}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
          {uploading > 0 ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <Upload className={cn("h-5 w-5", dropActive ? "text-primary" : "text-muted-foreground")} />
          )}
        </div>
        <span className="text-sm font-medium">
          {uploading > 0
            ? `Optimising and uploading ${uploading} image${uploading === 1 ? "" : "s"}…`
            : full
              ? `Maximum ${MAX} images reached`
              : dropActive
                ? "Drop to upload"
                : "Drag images here, or click to browse"}
        </span>
        {!full && uploading === 0 && (
          <span className="text-xs text-muted-foreground">
            Any image format · up to 10 MB each · optional
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        // Any image the OS can offer. The browse dialog must not filter out a
        // format the component is willing to convert.
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          acceptFiles(e.target.files);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {images.map((img, index) => (
            <div
              key={img.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
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
        {images.length}/{MAX} images. Optional, but products with photos sell noticeably better —
        front &amp; back at minimum are recommended.
      </p>
    </StepShell>
  );
}
