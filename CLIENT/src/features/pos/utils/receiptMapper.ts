import { CartItem } from "../types/pos.types";
import { PosReturnedItem } from "../store/usePosStore";
import { ReceiptData, ReceiptLine } from "./printReceipt";

const variantMeta = (v: CartItem["variant"] | PosReturnedItem["variant"]) =>
  [v.size?.name, v.color?.name, v.sku && `SKU ${v.sku}`].filter(Boolean).join(" · ");

/**
 * Builds receipt data from the local cart/returns plus the saved backend payload.
 * We use the local cart for line detail (it has full variant info) and the saved
 * payload for the authoritative bill number.
 */
export function buildReceiptData(args: {
  savedRaw: any;
  kind: "SALE" | "EXCHANGE";
  cart: CartItem[];
  returns: PosReturnedItem[];
  subtotal: number;
  discountTotal: number;
  returnTotal: number;
  grandTotal: number;
  payments: { method: string; amount: number }[];
  customerName?: string;
  customerPhone?: string;
  cashierName?: string;
  storeName?: string;
}): ReceiptData {
  const items: ReceiptLine[] = args.cart.map((i) => ({
    name: i.variant.product.name,
    meta: variantMeta(i.variant),
    qty: i.quantity,
    mrp: Number(i.variant.mrp),
    discount: i.discountAmount ?? 0,
    amount: i.lineTotal,
  }));

  const returns: ReceiptLine[] = args.returns.map((r) => ({
    name: r.variant.product.name,
    meta: variantMeta(r.variant),
    qty: r.quantity,
    mrp: r.mrp,
    discount: 0,
    amount: Number(r.variant.sellingPrice) * r.quantity,
  }));

  const number =
    args.savedRaw?.saleNumber ||
    args.savedRaw?.exchangeNumber ||
    args.savedRaw?.number ||
    args.savedRaw?.id ||
    "—";

  return {
    number,
    kind: args.kind,
    dateISO: args.savedRaw?.saleDate || args.savedRaw?.createdAt || new Date().toISOString(),
    cashierName: args.cashierName,
    customerName: args.customerName,
    customerPhone: args.customerPhone,
    items,
    returns: returns.length ? returns : undefined,
    subtotal: args.subtotal,
    discountTotal: args.discountTotal,
    returnTotal: args.returnTotal || undefined,
    grandTotal: args.grandTotal,
    payments: args.payments,
    storeName: args.storeName,
  };
}
