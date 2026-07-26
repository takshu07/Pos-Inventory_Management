import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  initialWizardState,
  type AttributeValues,
  type WizardState,
  type WizardVariant,
} from "./types";
import { generateVariants } from "./helpers";

/**
 * Wizard state container. A reducer holds the whole draft; the provider adds
 * debounced localStorage autosave (so a refresh mid-creation doesn't lose work)
 * and exposes convenience actions. Kept out of React Query — this is transient
 * form state, not server cache, until the final atomic submit.
 */

const DRAFT_KEY = "owner:product-wizard:draft:v1";

type Action =
  | { type: "PATCH"; patch: Partial<WizardState> }
  | { type: "SET_ATTRIBUTES"; attributes: AttributeValues }
  | { type: "REGENERATE_VARIANTS" }
  | { type: "SET_VARIANTS"; variants: WizardVariant[] }
  | { type: "PATCH_VARIANT"; id: string; patch: Partial<WizardVariant> }
  | { type: "PATCH_VARIANTS"; ids: string[]; patch: Partial<WizardVariant> }
  | { type: "REMOVE_VARIANT"; id: string }
  | { type: "RESTORE_VARIANT"; id: string }
  | { type: "PATCH_DEFAULTS"; patch: Partial<WizardState["defaults"]> }
  | { type: "RESET" }
  | { type: "HYDRATE"; state: WizardState };

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "PATCH":
      return { ...state, ...action.patch };
    case "SET_ATTRIBUTES":
      return { ...state, attributes: action.attributes };
    case "REGENERATE_VARIANTS":
      return {
        ...state,
        variants: generateVariants(state.attributes, state, state.variants),
      };
    case "SET_VARIANTS":
      return { ...state, variants: action.variants };
    case "PATCH_VARIANT":
      return {
        ...state,
        variants: state.variants.map((v) =>
          v.id === action.id ? { ...v, ...action.patch } : v
        ),
      };
    case "PATCH_VARIANTS": {
      const ids = new Set(action.ids);
      return {
        ...state,
        variants: state.variants.map((v) =>
          ids.has(v.id) ? { ...v, ...action.patch } : v
        ),
      };
    }
    case "REMOVE_VARIANT":
      return {
        ...state,
        variants: state.variants.map((v) =>
          v.id === action.id ? { ...v, removed: true } : v
        ),
      };
    case "RESTORE_VARIANT":
      return {
        ...state,
        variants: state.variants.map((v) =>
          v.id === action.id ? { ...v, removed: false } : v
        ),
      };
    case "PATCH_DEFAULTS":
      return { ...state, defaults: { ...state.defaults, ...action.patch } };
    case "HYDRATE":
      return action.state;
    case "RESET":
      return initialWizardState();
    default:
      return state;
  }
}

interface WizardContextValue {
  state: WizardState;
  dispatch: React.Dispatch<Action>;
  patch: (patch: Partial<WizardState>) => void;
  patchDefaults: (patch: Partial<WizardState["defaults"]>) => void;
  lastSavedAt: Date | null;
  clearDraft: () => void;
  hasDraft: boolean;
}

const WizardCtx = createContext<WizardContextValue | null>(null);

export function WizardProvider({
  children,
  autosave = true,
}: {
  children: ReactNode;
  autosave?: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, undefined, initialWizardState);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const firstRun = useRef(true);

  // Hydrate any existing draft once on mount.
  useEffect(() => {
    if (!autosave) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WizardState;
        dispatch({ type: "HYDRATE", state: parsed });
        setHasDraft(true);
      }
    } catch {
      /* ignore corrupt draft */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave.
  useEffect(() => {
    if (!autosave) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
        setLastSavedAt(new Date());
        setHasDraft(true);
      } catch {
        /* storage full / disabled — non-fatal */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [state, autosave]);

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
    setLastSavedAt(null);
    dispatch({ type: "RESET" });
  };

  const value: WizardContextValue = {
    state,
    dispatch,
    patch: (patch) => dispatch({ type: "PATCH", patch }),
    patchDefaults: (patch) => dispatch({ type: "PATCH_DEFAULTS", patch }),
    lastSavedAt,
    clearDraft,
    hasDraft,
  };

  return <WizardCtx.Provider value={value}>{children}</WizardCtx.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardCtx);
  if (!ctx) throw new Error("useWizard must be used within a WizardProvider");
  return ctx;
}
