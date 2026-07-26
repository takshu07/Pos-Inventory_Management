import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * ProductImageGallery — a main image with thumbnail strip. Read-only viewer used
 * by the details drawer in both modules. Gracefully degrades to a placeholder
 * when a product has no images.
 */
export function ProductImageGallery({
  images,
  alt,
  className,
}: {
  images: string[];
  alt: string;
  className?: string;
}) {
  const [active, setActive] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div
        className={cn(
          "flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-muted-foreground",
          className
        )}
      >
        <div className="flex flex-col items-center gap-2">
          <ImageOff className="h-8 w-8" />
          <span className="text-xs">No images</span>
        </div>
      </div>
    );
  }

  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted/20">
        <img src={current} alt={alt} className="h-full w-full object-contain" loading="lazy" />
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors",
                i === active ? "border-primary" : "border-border hover:border-muted-foreground"
              )}
              aria-label={`View image ${i + 1}`}
            >
              <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
