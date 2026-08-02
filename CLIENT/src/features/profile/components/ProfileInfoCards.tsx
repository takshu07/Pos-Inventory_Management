/**
 * The read-only halves of My Profile: personal information and account details.
 *
 * WHY NOTHING HERE IS EDITABLE
 * ----------------------------
 * There is no self-service profile-update endpoint. `/employees/:id` PATCH is
 * `requireRole("OWNER")`, and `enforceHierarchy` permits self-modification only
 * as a side effect of that owner check — a cashier cannot edit their own row.
 *
 * Rather than render inputs that would 403 for two of the three roles, or
 * quietly show an editable form to owners only (making the same screen behave
 * differently per role for no stated reason), these are presented as facts with
 * a line telling the user who to ask. Password is the one thing every role can
 * genuinely change about themselves, and it has its own card.
 *
 * TODO(self-service): the additive `PATCH /auth/me` endpoint is specified in
 * SERVER/src/services/auth.service.ts (above `me`). When it lands, turn
 * PersonalInfoCard into a form over exactly the fields that schema permits —
 * firstName, lastName, email, gender, address, dateOfBirth — and drop the "ask
 * the owner" line from its description.
 *
 * What must NOT become editable here, whatever the endpoint eventually accepts:
 * role, account status and salary are authorisation and payroll facts, and
 * phone is a sign-in identifier. AccountDetailsCard stays read-only.
 */

import { Info } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { ROLE_LABELS } from "@/features/auth";
import type { ProfileUser } from "../types";
import {
  formatDate,
  formatDateTime,
  formatGender,
} from "@/features/users/utils/format";
import { UserRoleBadge, UserStatusBadge } from "@/features/users/components/UserStatusBadge";

/** What each role can actually reach — shown so "my access" is answerable here. */
const ROLE_SCOPE: Record<string, string> = {
  OWNER:
    "Full access: business administration, finance, reports, catalog, procurement and staff.",
  MANAGER:
    "Shop floor: dashboard, checkout, sales, customers, read-only products and staff monitoring.",
  CASHIER: "Checkout and your own cash register.",
};

export function PersonalInfoCard({ user }: { user: ProfileUser }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal information</CardTitle>
        <CardDescription>
          Ask the owner to update these — they are managed in Users &amp; Roles.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
          <Row label="Full name" value={`${user.firstName} ${user.lastName}`} />
          <Row label="Phone" value={user.phone} />
          <Row label="Email" value={user.email ?? "Not set"} />
          <Row label="Gender" value={formatGender(user.gender)} />
          <Row label="Address" value={user.address || "Not set"} />
        </dl>
      </CardContent>
    </Card>
  );
}

export function AccountDetailsCard({ user }: { user: ProfileUser }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account details</CardTitle>
        <CardDescription>Your sign-in identity and what it grants.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
          <Row label="Employee code" value={user.employeeCode} />
          <Row
            label="Role"
            value={ROLE_LABELS[user.role]}
            badge={<UserRoleBadge role={user.role} />}
          />
          <Row
            label="Account status"
            value={user.isActive ? "Active" : "Deactivated"}
            badge={<UserStatusBadge isActive={user.isActive} />}
          />
          <Row label="Joined" value={formatDate(user.joiningDate)} />
          <Row label="Last sign-in" value={formatDateTime(user.lastLogin)} />
        </dl>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            {ROLE_SCOPE[user.role] ?? "Your access is set by your role."} Only the owner
            can change roles.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * A label/value row. When a `badge` is supplied it replaces the plain text —
 * role and status read better as the same badges used everywhere else, but the
 * text value is still what the type demands so nothing renders empty.
 */
function Row({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm">{badge ?? value}</dd>
    </div>
  );
}
