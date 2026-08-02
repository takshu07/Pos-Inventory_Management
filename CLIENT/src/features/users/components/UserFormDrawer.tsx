/**
 * Create / edit account form. ONE component, two modes.
 *
 * The two differ in exactly three ways — the password fields (create only), the
 * role selector (create only), and which mutation fires — and are identical in
 * every other field, label, validation rule and layout. Two files would drift
 * within a month, the same reasoning RosterPage applies to its two variants.
 *
 * WHY ROLE IS CREATE-ONLY
 * -----------------------
 * Changing an existing account's role is NOT part of editing their details. It
 * is a privileged operation with side effects the plain PATCH does not have:
 * the server closes every session and bumps the token version so the role in
 * the old JWT cannot outlive the change. It gets its own confirmation dialog
 * (ChangeRoleDialog) that states those consequences. Folding it into this form
 * would let someone re-role a colleague as a side effect of fixing a typo in
 * their phone number.
 *
 * WHY PASSWORD IS CREATE-ONLY
 * ---------------------------
 * Same principle. `/employees` PATCH does not accept a password at all — an
 * owner resetting one uses ResetPasswordDialog (which revokes sessions), and a
 * user changing their own uses My Profile (which requires the current password).
 */

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";

import { Button, Drawer, Input, Select } from "@/components/ui";
import { PasswordField } from "@/features/auth";
import { ROLE_LABELS } from "@/features/auth";
import { useCreateUser, useUpdateUser } from "../hooks/useUsers";
import {
  createUserSchema,
  editUserSchema,
  type CreateUserFormValues,
  type EditUserFormValues,
} from "../validation";
import type { AssignableRole, CreateUserPayload, UpdateUserPayload, User } from "../types";

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "OTHER", label: "Other" },
];

const ROLE_OPTIONS = [
  { value: "CASHIER", label: ROLE_LABELS.CASHIER },
  { value: "MANAGER", label: ROLE_LABELS.MANAGER },
];

/** Trims to undefined so an untouched optional field is omitted, not sent as "". */
function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** "2026-08-02" for <input type="date">, which rejects a full ISO timestamp. */
function toDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function UserFormDrawer({
  open,
  onClose,
  /** null = create mode; a user = edit mode. */
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: User | null;
}) {
  const isEdit = user !== null;

  return isEdit ? (
    <EditForm key={user.id} open={open} onClose={onClose} user={user} />
  ) : (
    <CreateForm open={open} onClose={onClose} />
  );
}

// =============================================================================
// CREATE
// =============================================================================

function CreateForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateUser();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
      role: "CASHIER",
      gender: "",
      address: "",
      salary: "",
      joiningDate: "",
      dateOfBirth: "",
    },
  });

  // The Drawer stays mounted when closed (see its header note), so a typed-but-
  // abandoned form would still be there on the next open — including a typed
  // password. Clearing on close is what stops that.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = (values: CreateUserFormValues) => {
    const payload: CreateUserPayload = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      phone: values.phone.trim(),
      password: values.password,
      role: values.role as AssignableRole,
      ...(optional(values.email) ? { email: values.email!.trim().toLowerCase() } : {}),
      ...(optional(values.gender) ? { gender: values.gender as CreateUserPayload["gender"] } : {}),
      ...(optional(values.address) ? { address: values.address!.trim() } : {}),
      ...(optional(values.salary) ? { salary: Number(values.salary) } : {}),
      ...(optional(values.joiningDate) ? { joiningDate: values.joiningDate! } : {}),
      ...(optional(values.dateOfBirth) ? { dateOfBirth: values.dateOfBirth! } : {}),
    };

    create.mutate(payload, {
      onSuccess: () => {
        reset();
        onClose();
      },
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add user"
      description="Create a sign-in account for a manager or cashier."
      width="w-full max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-user-form"
            loading={create.isPending}
          >
            Create account
          </Button>
        </>
      }
    >
      <form
        id="create-user-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-4"
      >
        <MutationError error={create.error} />

        <Section title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              required
              error={errors.firstName?.message}
              {...register("firstName")}
            />
            <Input
              label="Last name"
              required
              error={errors.lastName?.message}
              {...register("lastName")}
            />
          </div>
        </Section>

        <Section title="Sign-in details">
          <Input
            label="Phone number"
            required
            inputMode="numeric"
            placeholder="9876543210"
            hint="Used to sign in. Must be unique."
            error={errors.phone?.message}
            {...register("phone")}
          />
          <Input
            label="Email"
            type="email"
            placeholder="name@example.com"
            hint="Optional. Can also be used to sign in."
            error={errors.email?.message}
            {...register("email")}
          />
          <Select
            label="Role"
            required
            options={ROLE_OPTIONS}
            hint="Managers run the shop floor. Cashiers get the checkout screen only."
            error={errors.role?.message}
            {...register("role")}
          />
          <PasswordField
            label="Temporary password"
            required
            autoComplete="new-password"
            hint="8+ characters with an uppercase letter, a lowercase letter and a number."
            error={errors.password?.message}
            {...register("password")}
          />
          <PasswordField
            label="Confirm password"
            required
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />
        </Section>

        <Section title="Employment details" hint="All optional — can be filled in later.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Gender"
              options={GENDER_OPTIONS}
              error={errors.gender?.message}
              {...register("gender")}
            />
            <Input
              label="Monthly salary"
              type="number"
              min={0}
              placeholder="e.g. 25000"
              error={errors.salary?.message}
              {...register("salary")}
            />
            <Input
              label="Joining date"
              type="date"
              error={errors.joiningDate?.message}
              {...register("joiningDate")}
            />
            <Input
              label="Date of birth"
              type="date"
              error={errors.dateOfBirth?.message}
              {...register("dateOfBirth")}
            />
          </div>
          <Input
            label="Address"
            error={errors.address?.message}
            {...register("address")}
          />
        </Section>
      </form>
    </Drawer>
  );
}

// =============================================================================
// EDIT
// =============================================================================

function EditForm({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
}) {
  const update = useUpdateUser();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email ?? "",
      phone: user.phone,
      gender: (user.gender ?? "") as EditUserFormValues["gender"],
      address: user.address ?? "",
      salary: user.salary != null ? String(user.salary) : "",
      joiningDate: toDateInput(user.joiningDate),
      dateOfBirth: toDateInput(user.dateOfBirth),
    },
  });

  // Re-seed when a different account is opened, so the form never shows the
  // previous person's values under the new one's name.
  useEffect(() => {
    reset({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email ?? "",
      phone: user.phone,
      gender: (user.gender ?? "") as EditUserFormValues["gender"],
      address: user.address ?? "",
      salary: user.salary != null ? String(user.salary) : "",
      joiningDate: toDateInput(user.joiningDate),
      dateOfBirth: toDateInput(user.dateOfBirth),
    });
  }, [user, reset]);

  /**
   * Sends only what actually changed.
   *
   * A full-object PATCH would re-submit the unchanged phone and email on every
   * save, which makes the server run its uniqueness check against the user's
   * own current values — harmless today, but it also means an unrelated edit
   * fails if someone else happens to hold a conflicting value. Sending just the
   * dirty fields keeps the write honest about intent.
   *
   * Email is the one field where an empty string is MEANINGFUL: the server
   * reads `email: ""` as "clear this address". So it is passed through as-is
   * rather than trimmed to undefined.
   */
  const onSubmit = (values: EditUserFormValues) => {
    const payload: UpdateUserPayload = {};

    if (dirtyFields.firstName) payload.firstName = values.firstName.trim();
    if (dirtyFields.lastName) payload.lastName = values.lastName.trim();
    if (dirtyFields.phone) payload.phone = values.phone.trim();
    if (dirtyFields.email) payload.email = values.email?.trim().toLowerCase() ?? "";
    if (dirtyFields.gender) {
      const gender = optional(values.gender);
      if (gender) payload.gender = gender as UpdateUserPayload["gender"];
    }
    if (dirtyFields.address) payload.address = values.address?.trim() ?? "";
    if (dirtyFields.salary) {
      const salary = optional(values.salary);
      if (salary) payload.salary = Number(salary);
    }
    if (dirtyFields.joiningDate && values.joiningDate) {
      payload.joiningDate = values.joiningDate;
    }
    if (dirtyFields.dateOfBirth && values.dateOfBirth) {
      payload.dateOfBirth = values.dateOfBirth;
    }

    // Nothing changed — close rather than firing a pointless request that would
    // still emit a success toast and invalidate every cache.
    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    update.mutate({ id: user.id, payload }, { onSuccess: onClose });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit ${user.firstName} ${user.lastName}`}
      description="Identity and employment details. Role and password are changed separately."
      width="w-full max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-user-form" loading={update.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        id="edit-user-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-4"
      >
        <MutationError error={update.error} />

        <Section title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              required
              error={errors.firstName?.message}
              {...register("firstName")}
            />
            <Input
              label="Last name"
              required
              error={errors.lastName?.message}
              {...register("lastName")}
            />
          </div>
        </Section>

        <Section title="Sign-in details">
          <Input
            label="Phone number"
            required
            inputMode="numeric"
            hint="Used to sign in. Must be unique."
            error={errors.phone?.message}
            {...register("phone")}
          />
          <Input
            label="Email"
            type="email"
            hint="Optional. Clear the box to remove the address."
            error={errors.email?.message}
            {...register("email")}
          />
        </Section>

        <Section title="Employment details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Gender"
              options={GENDER_OPTIONS}
              error={errors.gender?.message}
              {...register("gender")}
            />
            <Input
              label="Monthly salary"
              type="number"
              min={0}
              error={errors.salary?.message}
              {...register("salary")}
            />
            <Input
              label="Joining date"
              type="date"
              error={errors.joiningDate?.message}
              {...register("joiningDate")}
            />
            <Input
              label="Date of birth"
              type="date"
              error={errors.dateOfBirth?.message}
              {...register("dateOfBirth")}
            />
          </div>
          <Input
            label="Address"
            error={errors.address?.message}
            {...register("address")}
          />
        </Section>
      </form>
    </Drawer>
  );
}

// =============================================================================
// SHARED PIECES
// =============================================================================

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Inline server error.
 *
 * The mutation hooks already toast, but a toast is transient and this form can
 * be long enough to scroll. Conflicts ("phone number already exists") name the
 * field the user has to go fix, so the message needs to stay on screen next to
 * it rather than fading after four seconds.
 */
function MutationError({ error }: { error: Error | null }) {
  if (!error) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="text-sm text-destructive">
        {error.message || "Something went wrong. Please try again."}
      </p>
    </div>
  );
}
