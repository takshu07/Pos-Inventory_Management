// =============================================================================
// EXPRESS TYPE AUGMENTATION
// Extends Express's Request interface to carry the authenticated user context.
//
// Import path points to our domain types, NOT to Prisma-generated types.
// This is intentional — the HTTP layer should depend on domain types, not
// on database implementation details.
// =============================================================================

import type { AuthenticatedUser } from "./employee.types";

declare global {
  namespace Express {
    interface Request {
      /**
       * Populated by the `authenticate` middleware after a valid JWT is
       * verified. Will be `undefined` on unauthenticated routes — do not
       * access `req.user` without first passing through `authenticate`.
       */
      user: AuthenticatedUser;
    }
  }
}

export {};