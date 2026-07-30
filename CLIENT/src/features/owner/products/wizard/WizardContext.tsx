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
  type VariantPriceOverride,
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

// v2 — pricing moved to state.pricing and variants hold overrides only. v1 drafts
// (per-variant costPrice/sellingPrice/mrp) are structurally incompatible, so the
// key is bumped rather than migrated; stale v1 drafts are cleaned up on mount.
const DRAFT_KEY = "owner:product-wizard:draft:v2";
const LEGACY_DRAFT_KEYS = ["owner:product-wizard:draft:v1"];

type Action =
  // The updater form is for patches that must build on the LATEST state rather
  // than the state captured when the handler was created — e.g. several image
  // uploads resolving concurrently, each appending to the same array.
  | {
      type: "PATCH";
      patch: Partial<WizardState> | ((prev: WizardState) => Partial<WizardState>);
    }
  | { type: "SET_ATTRIBUTES"; attributes: AttributeValues }
  | { type: "REGENERATE_VARIANTS" }
  | { type: "SET_VARIANTS"; variants: WizardVariant[] }
  | { type: "PATCH_VARIANT"; id: string; patch: Partial<WizardVariant> }
  | { type: "PATCH_VARIANTS"; ids: string[]; patch: Partial<WizardVariant> }
  | { type: "REMOVE_VARIANT"; id: string }
  | { type: "RESTORE_VARIANT"; id: string }
  | { type: "PATCH_DEFAULTS"; patch: Partial<WizardState["defaults"]> }
  | { type: "PATCH_PRICING"; patch: Partial<WizardState["pricing"]> }
  | { type: "SET_PRICE_OVERRIDE"; id: string; override: VariantPriceOverride }
  | { type: "CLEAR_PRICE_OVERRIDE"; id: string }
  | { type: "RESET" }
  | { type: "HYDRATE"; state: WizardState };

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "PATCH":
      return {
        ...state,
        ...(typeof action.patch === "function" ? action.patch(state) : action.patch),
      };
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
    case "PATCH_PRICING":
      // Product-level pricing changes need no variant fan-out: every variant
      // without an override reads through to this object automatically.
      return { ...state, pricing: { ...state.pricing, ...action.patch } };
    case "SET_PRICE_OVERRIDE":
      return {
        ...state,
        variants: state.variants.map((v) =>
          v.id === action.id ? { ...v, priceOverride: action.override } : v
        ),
      };
    case "CLEAR_PRICE_OVERRIDE":
      return {
        ...state,
        variants: state.variants.map((v) =>
          v.id === action.id ? { ...v, priceOverride: null } : v
        ),
      };
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
  /** Update the single authoritative pricing block. */
  patchPricing: (patch: Partial<WizardState["pricing"]>) => void;
  setPriceOverride: (id: string, override: VariantPriceOverride) => void;
  clearPriceOverride: (id: string) => void;
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

  // Hydrate any existing draft once on mount, and drop drafts from the older
  // (duplicated-pricing) schema so they can never resurrect removed fields.
  useEffect(() => {
    if (!autosave) return;
    try {
      LEGACY_DRAFT_KEYS.forEach((k) => localStorage.removeItem(k));
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WizardState;
        // Shape guard: only hydrate drafts that carry the v2 pricing block.
        if (parsed && typeof parsed === "object" && parsed.pricing) {
          dispatch({
            type: "HYDRATE",
            state: {
              ...parsed,
              variants: (parsed.variants ?? []).map((v) => ({
                ...v,
                priceOverride: v.priceOverride ?? null,
              })),
            },
          });
          setHasDraft(true);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
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
    patchPricing: (patch) => dispatch({ type: "PATCH_PRICING", patch }),
    setPriceOverride: (id, override) =>
      dispatch({ type: "SET_PRICE_OVERRIDE", id, override }),
    clearPriceOverride: (id) => dispatch({ type: "CLEAR_PRICE_OVERRIDE", id }),
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
