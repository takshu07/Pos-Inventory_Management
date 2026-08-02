/**
 * My Profile — domain types.
 *
 * `ProfileUser` mirrors `EMPLOYEE_PUBLIC_SELECT` in the server's
 * auth.repository — the exact projection `/auth/me` returns. It is a superset
 * of the `AuthUser` kept in the auth store: the store holds only what the shell
 * needs (id, name, role, and enough to render a navbar), while /auth/me also
 * returns gender, address, joiningDate and lastLogin.
 *
 * That difference is the whole reason this screen re-fetches rather than
 * rendering the store: the store simply does not contain the fields a profile
 * page shows.
 */

import type { Role } from "@/types";

export interface ProfileUser {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  role: Role;
  gender: string | null;
  address: string | null;
  joiningDate: string;
  isActive: boolean;
  lastLogin: string | null;
}
