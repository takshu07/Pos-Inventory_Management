import { PaginatedResponse } from "@/types";

export interface Product {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  brandId: string;
  hsnCode: string;
  basePrice: number;
  finalPrice: number;
  taxRate: number;
  isCustomTax: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProductListResponse = PaginatedResponse<Product>;

// Define strict validation interfaces here if needed
