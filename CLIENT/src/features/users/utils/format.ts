/**
 * Users & Roles — display formatting.
 *
 * Every helper here answers the same question: what do we show when the value
 * is absent? A missing email is not "-", a never-signed-in account is not
 * "Never" by accident, and a null salary is "Not recorded" rather than ₹0.
 * Those are different facts, and rendering a gap as a zero is a lie the rest of
 * this codebase deliberately avoids (see the monthlyTarget rule in Workforce).
 */

/** "Rahul Sharma" — the name shown everywhere a row is identified. */
export function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

/** "RS" — avatar fallback when there is no photo. */
export function initials(user: { firstName: string; lastName: string }): string {
  const first = user.firstName?.[0] ?? "";
  const last = user.lastName?.[0] ?? "";
  return (first + last).toUpperCase() || "?";
}

/** "2 Aug 2026". Invalid or absent dates render as an em dash, never "Invalid Date". */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "2 Aug 2026, 4:30 pm" — used where the time of day carries meaning (last sign-in). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Relative sign-in recency: "Never", "Today", "Yesterday", "12 days ago".
 *
 * "Never" is a first-class answer, not a fallback — an account that has never
 * been used is exactly what an owner auditing access is looking for.
 */
export function formatLastLogin(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(value);
}

/**
 * "₹45,000" or "Not recorded".
 *
 * Salary arrives as a Prisma Decimal, which serialises to a STRING — coercing
 * through Number here is what stops "45000.00" rendering literally.
 */
export function formatSalary(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  const amount = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(amount)) return "Not recorded";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Sentence-cased gender, or an em dash. Avoids shouting "MALE" in a detail panel. */
export function formatGender(value: string | null | undefined): string {
  if (!value) return "—";
  return value.charAt(0) + value.slice(1).toLowerCase();
}
