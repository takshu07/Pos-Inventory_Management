// =============================================================================
// EXPRESS TYPE AUGMENTATION
//
// The authentication middleware attaches the decoded JWT context to the request
// (`req.user = { id, role, tokenVersion }`), and controllers/middleware read it
// on nearly every protected route. Express's own Request type knows nothing
// about that field, so it must be declared here.
//
// This file is a global declaration, NOT a module: it deliberately has no
// top-level import/export, because adding one would turn it into a module and
// silently stop the `declare global` augmentation from applying.
// =============================================================================

declare global {
  namespace Express {
    interface Request {
      /**
       * Populated by auth.middleware#authenticate.
       *
       * Declared non-optional deliberately. Every controller that reads it sits
       * behind `authenticate`, which either sets this or rejects the request
       * before the handler runs — so at handler time it is always present, and
       * the whole codebase (including `req.user.id` in the discount controllers)
       * is written against that guarantee. Typing it optional would force a
       * non-null assertion at ~90 call sites without making any of them safer.
       *
       * The corollary: do NOT read req.user in a handler mounted outside
       * `authenticate`. Public routes must not touch it.
       */
      user: import("./employee.types").AuthenticatedUser;
    }
  }
}

export {};
