/**
 * My Profile — ONE implementation, mounted at TWO routes.
 *
 *   /profile          → manager portal (MainLayout shell)
 *   /cashier/profile  → cashier portal (CashierLayout shell)
 *
 * The requirement is explicit that both routes share one implementation, and
 * nothing here is portal-aware: the shell differs, the screen does not. Every
 * role sees their own record because the data comes from `/auth/me`, which is
 * scoped to the JWT — there is no id in the URL to tamper with, and no way to
 * ask this screen for somebody else's profile.
 *
 * This is the same pattern the two portals already use for PosView: mount the
 * same component, let the layout differ. A second copy for cashiers would drift
 * and would mean a password-policy fix landing on one portal only.
 *
 * WHY IT RE-FETCHES RATHER THAN READING THE STORE
 * -----------------------------------------------
 * The Zustand store holds `AuthUser` — enough for a navbar. A profile screen
 * shows gender, address, joining date and last sign-in, none of which are in
 * the store. `useCurrentUser` also revalidates the session as a side effect, so
 * an account deactivated or re-roled since login surfaces here rather than at
 * the next mutation. The store is used only as instant placeholder content so
 * the page paints a name immediately instead of a spinner.
 */

import { Card, CardContent, ErrorState, Skeleton } from "@/components/ui";
import { useCurrentUser } from "@/features/auth";
import { useAuthStore } from "@/store/auth.store";
import { ChangePasswordCard } from "../components/ChangePasswordCard";
import { AccountDetailsCard, PersonalInfoCard } from "../components/ProfileInfoCards";
import type { ProfileUser } from "../types";

export function ProfileView() {
  const query = useCurrentUser();
  const storedUser = useAuthStore((s) => s.user);

  const user = query.data as ProfileUser | undefined;

  // A hard failure with nothing cached — the only state where the page cannot
  // render anything truthful. `useCurrentUser` is enabled-gated on the token,
  // so this is a real request failure, not the unauthenticated case (which the
  // route guards handle before this component mounts).
  if (query.isError && !user) {
    return (
      <div className="p-6">
        <ErrorState
          title="Could not load your profile"
          message="Check your connection and try again."
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* Falls back to the store so the heading is never a blank line while
              /auth/me is in flight. */}
          {user || storedUser
            ? `Signed in as ${(user ?? storedUser)!.firstName} ${(user ?? storedUser)!.lastName}`
            : "Your account details and password."}
        </p>
      </header>

      {!user ? (
        <ProfileSkeleton />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left column: who you are. Right column: what you can change.
              On a phone these stack in that same order — reading your details
              before changing your password is the natural sequence. */}
          <div className="flex flex-col gap-6">
            <PersonalInfoCard user={user} />
            <AccountDetailsCard user={user} />
          </div>

          <div className="flex flex-col gap-6">
            <ChangePasswordCard />
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {[0, 1].map((column) => (
        <div key={column} className="flex flex-col gap-6">
          <Card>
            <CardContent className="pt-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-2 h-3.5 w-56" />
              <div className="mt-5 flex flex-col gap-3">
                {Array.from({ length: 5 }).map((_, row) => (
                  <div key={row} className="flex items-center justify-between gap-4">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3.5 w-32" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}

export default ProfileView;
