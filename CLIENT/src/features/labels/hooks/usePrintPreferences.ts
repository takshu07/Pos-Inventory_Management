/**
 * Remembers the user's last print selections across dialogs and sessions.
 *
 * "Remember previous selections" from the spec. Stored in localStorage rather
 * than server-side because these are per-DEVICE ergonomics: the till next to
 * the counter printer should keep choosing that printer, even though the same
 * user account also logs in at the stock room terminal.
 */

import * as React from "react";

const STORAGE_KEY = "labels:print-preferences:v1";

export interface PrintPreferences {
  templateId: string | null;
  printerId: string | null;
  copies: number;
}

const DEFAULTS: PrintPreferences = {
  templateId: null,
  printerId: null,
  copies: 1,
};

function read(): PrintPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PrintPreferences>;
    return {
      templateId: typeof parsed.templateId === "string" ? parsed.templateId : null,
      printerId: typeof parsed.printerId === "string" ? parsed.printerId : null,
      // Clamp: a corrupted or hand-edited value must never queue 10,000 labels.
      copies:
        typeof parsed.copies === "number" && parsed.copies >= 1 && parsed.copies <= 999
          ? Math.floor(parsed.copies)
          : 1,
    };
  } catch {
    // Private browsing or disabled storage — fall back to defaults rather than
    // breaking the dialog.
    return DEFAULTS;
  }
}

export function usePrintPreferences() {
  const [preferences, setPreferences] = React.useState<PrintPreferences>(read);

  const update = React.useCallback((patch: Partial<PrintPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Persisting is best-effort; the in-memory value still applies.
      }
      return next;
    });
  }, []);

  return { preferences, update };
}
