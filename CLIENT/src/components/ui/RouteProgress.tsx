import * as React from "react";
import { useNavigation } from "react-router";

/**
 * RouteProgress — Global navigation progress indicator.
 *
 * WHY THIS EXISTS: every route in app/router/index.tsx is code-split behind
 * `lazy()`. In a React Router data router, a navigation does not swap the
 * screen until that chunk has downloaded — so between the click and the new
 * page there is a window (one network round-trip, longer on a cold cache or a
 * shop's flaky wifi) where the OLD page is still on screen and absolutely
 * nothing indicates the app heard the click. Users read that silence as "the
 * app is frozen" and click again.
 *
 * This bar closes that gap. It is the single highest-leverage perceived-speed
 * fix in the shell: the app stops feeling slow even though nothing about the
 * actual load time changed.
 *
 * Two details that matter:
 *   - DELAY: navigations that resolve fast (warm chunk, same-origin cache) must
 *     NOT flash a bar — a 16ms flicker reads as a glitch, not as feedback. We
 *     wait APPEAR_DELAY_MS before showing anything, so instant navigations stay
 *     visually silent and only genuinely-slow ones get an indicator.
 *   - EASE-OUT CREEP: the bar approaches but never reaches 100% while loading
 *     (it decays toward CEILING). Real progress is unknowable here, and a bar
 *     that sits at 100% while the page is still blank is a worse lie than one
 *     that is still visibly moving.
 */

/** Don't show a bar for navigations faster than this — a flash reads as jank. */
const APPEAR_DELAY_MS = 150;
/** Creep tick interval. */
const TICK_MS = 200;
/** Never creep past this; the remainder is filled on completion. */
const CEILING = 90;
/** How long the filled bar lingers at 100% before fading out. */
const FINISH_LINGER_MS = 250;

export function RouteProgress() {
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  const [visible, setVisible] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (isNavigating) {
      // Arm the delayed reveal, then creep toward CEILING with an ease-out
      // curve (each tick closes a fraction of the REMAINING distance, so the
      // bar decelerates the longer the load takes instead of stalling flat).
      let creep: ReturnType<typeof setInterval> | undefined;

      const reveal = setTimeout(() => {
        setVisible(true);
        setProgress(12);
        creep = setInterval(() => {
          setProgress((p) => (p >= CEILING ? p : p + (CEILING - p) * 0.18));
        }, TICK_MS);
      }, APPEAR_DELAY_MS);

      return () => {
        clearTimeout(reveal);
        if (creep) clearInterval(creep);
      };
    }

    // Idle. If a bar is on screen, complete it honestly (100%) and fade out.
    // If none was ever revealed, this is a no-op — the fast-navigation path.
    if (!visible) return;

    setProgress(100);
    const done = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, FINISH_LINGER_MS);

    return () => clearTimeout(done);
    // `visible` is read, not driven, here: including it would restart the
    // completion timer when setVisible(false) lands. The isNavigating edge is
    // the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNavigating]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
      role="progressbar"
      aria-label="Loading page"
      aria-busy={isNavigating}
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--color-primary)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
    </div>
  );
}
