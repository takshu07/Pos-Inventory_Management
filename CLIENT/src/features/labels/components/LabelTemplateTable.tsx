/**
 * LabelTemplateTable — OWNER-only template management.
 *
 * System templates are marked and protected: they can be previewed and cloned
 * but not edited or deleted. That protection is enforced server-side; this UI
 * simply avoids offering actions that would 403, which is friendlier than
 * letting the user discover it via an error toast.
 */

import * as React from "react";
import { Copy, Lock, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from "@/components/ui";

import {
  useDeleteTemplate,
  useDuplicateTemplate,
  useLabelTemplates,
} from "../hooks/useLabels";
import { LabelPreview } from "./LabelPreview";

export function LabelTemplateTable() {
  const { data: templates, isLoading } = useLabelTemplates({ includeInactive: true });
  const duplicateMutation = useDuplicateTemplate();
  const deleteMutation = useDeleteTemplate();

  const [previewId, setPreviewId] = React.useState<string | null>(null);

  if (isLoading) return <TableSkeleton rows={5} cols={6} />;

  if (!templates || templates.length === 0) {
    return (
      <EmptyState
        title="No label templates"
        description="The built-in templates are seeded automatically when the server starts."
      />
    );
  }

  const previewTemplate = templates.find((template) => template.id === previewId);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Template</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead className="text-right">Times used</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {templates.map((template) => (
              <TableRow
                key={template.id}
                className={template.isActive ? "" : "opacity-50"}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{template.name}</span>
                    {template.isSystem && (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="h-3 w-3" />
                        Built-in
                      </Badge>
                    )}
                    {!template.isActive && (
                      <span className="text-xs text-muted-foreground">(inactive)</span>
                    )}
                  </div>
                  {template.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {template.description}
                    </p>
                  )}
                </TableCell>

                <TableCell className="text-sm">
                  {template.kind.replace(/_/g, " ").toLowerCase()}
                </TableCell>

                <TableCell className="text-sm tabular-nums">
                  {Number(template.widthMm)} × {Number(template.heightMm)} mm
                </TableCell>

                <TableCell className="text-sm">
                  {template.barcodeSymbology === "NONE" ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    template.barcodeSymbology
                  )}
                </TableCell>

                <TableCell className="text-right tabular-nums">
                  {template.usageCount}
                </TableCell>

                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewId(template.id)}
                    >
                      Preview
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Copy className="h-3.5 w-3.5" />}
                      onClick={() =>
                        duplicateMutation.mutate({ id: template.id })
                      }
                      loading={
                        duplicateMutation.isPending &&
                        duplicateMutation.variables?.id === template.id
                      }
                    >
                      Duplicate
                    </Button>
                    {/* Built-ins are the fallback every module relies on —
                        deleting one would break printing globally. */}
                    {!template.isSystem && (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => deleteMutation.mutate(template.id)}
                        loading={
                          deleteMutation.isPending &&
                          deleteMutation.variables === template.id
                        }
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Modal
        open={previewId !== null}
        onClose={() => setPreviewId(null)}
        title={previewTemplate ? previewTemplate.name : "Template preview"}
        description="Rendered with sample product data."
        size="md"
      >
        {/* sample=true so a template can be inspected without picking a product. */}
        <LabelPreview templateId={previewId} sample initialZoom={2} />
      </Modal>
    </div>
  );
}
