import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Theme Provider
 * Responsibility: Manages the dark/light mode state and manipulates the document DOM.
 *
 * The first paint is NOT this component's job — an inline script in index.html
 * stamps the resolved theme before any JS module loads, because doing it here
 * (in an effect) means a white flash on every load for dark-theme users. This
 * provider owns the theme from that point on: the toggle, persistence, and
 * keeping the DOM in sync. Both must resolve the theme identically; see the
 * comment in index.html.
 */
export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "cex-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    // localStorage throws in private/blocked-cookie contexts. A theme preference
    // is never worth taking the whole app down for.
    try {
      return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
    } catch {
      return defaultTheme;
    }
  });

  useEffect(() => {
    const root = window.document.documentElement;

    const apply = (resolved: "light" | "dark") => {
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
      // The Tailwind `dark:` variants key off the CLASS, but the chart modules
      // (features/inventory, features/workforce) key off this ATTRIBUTE for their
      // viz palettes. Stamping both is what makes the in-app toggle actually
      // reach the charts — keyed on the class alone they stayed on whatever the
      // OS preferred, so a user toggling to dark got a dark app with light charts.
      root.setAttribute("data-theme", resolved);
    };

    if (theme !== "system") {
      apply(theme);
      return;
    }

    const media = window.matchMedia(DARK_QUERY);
    apply(media.matches ? "dark" : "light");

    // On "system", follow the OS live. Without this listener the app only picked
    // up an OS light/dark switch on a full reload — so it would sit in the wrong
    // theme for as long as the tab stayed open (e.g. at an automatic sunset switch
    // mid-shift).
    const onChange = (e: MediaQueryListEvent) => apply(e.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const handleSetTheme = useCallback(
    (next: Theme) => {
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Preference won't survive a reload; the current session still works.
      }
      setTheme(next);
    },
    [storageKey]
  );

  // Memoized so a new object identity doesn't re-render every consumer of this
  // context on each render of whatever sits above it.
  const value = useMemo(
    () => ({ theme, setTheme: handleSetTheme }),
    [theme, handleSetTheme]
  );

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
