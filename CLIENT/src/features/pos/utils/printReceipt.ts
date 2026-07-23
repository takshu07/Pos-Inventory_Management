import { formatCurrency } from "./pos.utils";

export interface ReceiptLine {
  name: string;
  meta?: string; // size · colour · sku
  qty: number;
  mrp: number;
  discount: number;
  amount: number;
}

export interface ReceiptData {
  number: string;
  kind: "SALE" | "EXCHANGE";
  dateISO: string;
  cashierName?: string;
  customerName?: string;
  customerPhone?: string;
  items: ReceiptLine[];
  returns?: ReceiptLine[];
  subtotal: number;
  discountTotal: number;
  returnTotal?: number;
  grandTotal: number;
  payments: { method: string; amount: number }[];
  storeName?: string;
}

const esc = (s: string | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Renders an 80mm thermal-receipt HTML document. Kept self-contained (inline CSS)
 * so it can be dropped into a hidden iframe and printed without app styles.
 */
export function buildReceiptHtml(data: ReceiptData): string {
  const row = (l: ReceiptLine) => `
    <tr>
      <td class="l">
        ${esc(l.name)}
        ${l.meta ? `<div class="meta">${esc(l.meta)}</div>` : ""}
      </td>
      <td class="c">${l.qty}</td>
      <td class="r">${formatCurrency(l.amount)}</td>
    </tr>`;

  const paymentRows = data.payments
    .map(
      (p) =>
        `<div class="line"><span>${esc(p.method)}</span><span>${formatCurrency(p.amount)}</span></div>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(data.number)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; color: #000; font-family: "Courier New", monospace; }
  .receipt { width: 80mm; padding: 6mm 4mm; margin: 0 auto; font-size: 12px; line-height: 1.4; }
  .center { text-align: center; }
  .store { font-size: 15px; font-weight: 700; letter-spacing: 1px; }
  .muted { color: #333; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; padding-bottom: 3px; }
  td { padding: 3px 0; vertical-align: top; font-size: 12px; }
  td.c, th.c { text-align: center; width: 34px; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  td.l { padding-right: 6px; }
  .meta { font-size: 10px; color: #444; }
  .line { display: flex; justify-content: space-between; margin: 2px 0; }
  .total { font-weight: 700; font-size: 14px; }
  .tag { display: inline-block; border: 1px solid #000; padding: 1px 6px; font-size: 10px; margin-top: 3px; }
  @media print { .receipt { width: 80mm; } @page { margin: 0; } }
</style>
</head>
<body>
  <div class="receipt">
    <div class="center store">${esc(data.storeName || "POS STORE")}</div>
    <div class="center muted">${data.kind === "EXCHANGE" ? "EXCHANGE RECEIPT" : "TAX INVOICE"}</div>
    <div class="center"><span class="tag">${esc(data.number)}</span></div>
    <hr />
    <div class="line"><span>Date</span><span>${new Date(data.dateISO).toLocaleString("en-IN")}</span></div>
    ${data.cashierName ? `<div class="line"><span>Cashier</span><span>${esc(data.cashierName)}</span></div>` : ""}
    ${data.customerName ? `<div class="line"><span>Customer</span><span>${esc(data.customerName)}</span></div>` : ""}
    ${data.customerPhone ? `<div class="line"><span>Mobile</span><span>${esc(data.customerPhone)}</span></div>` : ""}
    <hr />
    <table>
      <thead>
        <tr><th class="l">Item</th><th class="c">Qty</th><th class="r">Amount</th></tr>
      </thead>
      <tbody>
        ${data.items.map(row).join("")}
      </tbody>
    </table>
    ${
      data.returns && data.returns.length
        ? `<hr /><div class="muted">Returned</div>
           <table><tbody>${data.returns.map(row).join("")}</tbody></table>`
        : ""
    }
    <hr />
    <div class="line"><span>Subtotal</span><span>${formatCurrency(data.subtotal)}</span></div>
    ${data.discountTotal > 0 ? `<div class="line"><span>Discount</span><span>-${formatCurrency(data.discountTotal)}</span></div>` : ""}
    ${data.returnTotal ? `<div class="line"><span>Returned Value</span><span>-${formatCurrency(data.returnTotal)}</span></div>` : ""}
    <div class="line total"><span>${data.kind === "EXCHANGE" ? "Amount Due" : "Grand Total"}</span><span>${formatCurrency(data.grandTotal)}</span></div>
    <hr />
    ${paymentRows || `<div class="line"><span>Paid</span><span>${formatCurrency(0)}</span></div>`}
    <hr />
    <div class="center muted">Thank you for shopping with us!</div>
  </div>
</body>
</html>`;
}

/**
 * Prints a receipt via a hidden iframe so the main app UI is never disturbed.
 */
export function printReceipt(data: ReceiptData): void {
  const html = buildReceiptHtml(data);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const win = iframe.contentWindow!;
  const cleanup = () => {
    // Delay removal so the print dialog can read the document first.
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 500);
  };

  win.onafterprint = cleanup;
  // Give the iframe a tick to lay out before printing.
  setTimeout(() => {
    win.focus();
    win.print();
    // Fallback cleanup for browsers that never fire onafterprint.
    setTimeout(cleanup, 2000);
  }, 100);
}
