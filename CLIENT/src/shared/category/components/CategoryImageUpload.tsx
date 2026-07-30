import { useCallback, useRef, useState } from "react";
import { ImageOff, Link2, Loader2, Trash2, Upload } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { apiClient } from "@/lib/api/axios";
import { cn } from "@/utils/cn";
import {
  MAX_BYTES,
  isImageFile,
  optimizeImage,
  uploadFilename,
} from "@/shared/images/optimizeImage";

/**
 * CategoryImageUpload — drag & drop, click-to-browse, or paste a URL (Phase 2).
 *
 * Uploads go to the existing asset module (`POST /assets/upload`) rather than a
 * category-specific endpoint — storage, validation and access control already
 * live there and must not be duplicated. The stored value is the asset's
 * download path, which is why the server's imageUrl validator accepts relative
 * paths as well as absolute URLs.
 *
 * File intake (accepted formats, size cap, downscale/normalise-to-WebP) is
 * shared with the product wizard's picker — see @/shared/images/optimizeImage.
 */

export function CategoryImageUpload({
  value,
  onChange,
  categoryId,
  disabled = false,
}: {
  value: string;
  onChange: (url: string) => void;
  categoryId?: string;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);

      if (!isImageFile(file)) {
        setError("That file isn't an image. Choose an image file.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("Image must be smaller than 10 MB.");
        return;
      }

      setUploading(true);
      try {
        let optimized: Blob;
        try {
          optimized = await optimizeImage(file);
        } catch {
          // The browser could not decode this image, so we can neither convert
          // nor display it. Say so plainly instead of uploading a file that
          // would render as a broken image everywhere.
          setError(
            "This browser can't read that image format. Try saving it as JPG, PNG or WebP."
          );
          return;
        }

        const form = new FormData();
        form.append("file", optimized, uploadFilename(file, optimized));
        form.append("ownerModule", "CATEGORY");
        if (categoryId) form.append("ownerEntityId", categoryId);
        // PUBLIC because this image is rendered by <img src=…> in tables, cards
        // and the drawer. A browser image request carries no Authorization
        // header, so a PRIVATE asset would 401 and show as a broken thumbnail.
        // Category art is non-sensitive catalog decoration — the assets that
        // need protecting (invoices, documents) keep the PRIVATE default.
        form.append("visibility", "PUBLIC");

        // The response interceptor returns the server's { success, message, data }
        // envelope, so the created asset is at `.data` — the same shape every
        // other call site in the app reads.
        const res = await apiClient.post<{ id: string }>("/assets/upload", form);
        const assetId = (res.data as { id?: string })?.id;

        if (!assetId) throw new Error("Upload did not return an asset id.");
        onChange(`/api/v1/assets/${assetId}/download`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Upload failed. Please try again."
        );
      } finally {
        setUploading(false);
      }
    },
    [categoryId, onChange]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium leading-none">Category image</label>
        <button
          type="button"
          onClick={() => setShowUrlInput((s) => !s)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Link2 className="h-3 w-3" />
          {showUrlInput ? "Use upload" : "Use a URL"}
        </button>
      </div>

      {showUrlInput ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com/category.jpg"
          disabled={disabled}
        />
      ) : value ? (
        <div className="relative overflow-hidden rounded-md border border-border">
          <img src={value} alt="Category" className="h-40 w-full object-cover" />
          <div className="absolute right-2 top-2 flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={disabled || uploading}
              onClick={() => onChange("")}
              aria-label="Remove image"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
            disabled && "cursor-not-allowed opacity-60"
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Optimising and uploading…</span>
            </>
          ) : (
            <>
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                {dragging ? (
                  <Upload className="h-5 w-5 text-primary" />
                ) : (
                  <ImageOff className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <span className="text-sm font-medium">
                {dragging ? "Drop to upload" : "Drag an image here, or click to browse"}
              </span>
              <span className="text-xs text-muted-foreground">
                Any image format · up to 10 MB
              </span>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        // Any image the OS can offer. The browse dialog must not filter out a
        // format the component is willing to convert.
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
