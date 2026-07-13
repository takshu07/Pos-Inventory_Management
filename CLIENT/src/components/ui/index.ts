/**
 * Design System — Public Barrel Export
 * 
 * All shared UI primitives are re-exported from this single index.
 * Features and pages import from "@/components/ui", never from individual files.
 *
 * Correct: import { Button, Input } from "@/components/ui"
 * Wrong:   import { Button } from "@/components/ui/Button"
 */

export { Button } from "./Button";
export type { ButtonProps } from "./Button";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Select } from "./Select";
export type { SelectProps, SelectOption } from "./Select";

export { SearchBox } from "./SearchBox";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./Card";

export { Badge } from "./Badge";
export type { BadgeProps } from "./Badge";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./Table";

export { Pagination } from "./Pagination";
export { Modal } from "./Modal";
export { Drawer } from "./Drawer";

export { Skeleton, TableSkeleton, CardSkeleton } from "./Skeleton";
export { EmptyState, ErrorState, OfflineState } from "./StateViews";

export { LoadingSpinner, FullScreenLoader } from "./LoadingSpinner";
export { ErrorBoundary } from "./ErrorBoundary";
