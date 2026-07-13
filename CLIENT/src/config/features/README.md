# Feature-Based Architecture

This directory is the core of the Frontend Application. We strictly follow a Feature-Based Architecture, meaning code is grouped by **Domain** (e.g., Sales, Inventory, Auth), not by **Technical Role** (e.g., Components, Hooks).

## Why?
As this POS scales to 100,000+ lines of code, grouping by technical role (e.g., placing all hooks in `/src/hooks`) creates massive, unmaintainable directories. Feature-Based grouping keeps related code together, making it easy to delete, test, or refactor an entire module.

## Feature Structure
Every new business module created inside this directory MUST follow this template:

```text
src/features/feature-name/
├── api/          # Axios queries & mutations specific to this feature
├── components/   # UI components specific to this feature
├── hooks/        # React hooks (e.g., useCheckout.ts)
├── stores/       # Local zustand stores for this feature
├── types/        # TypeScript interfaces (e.g., SaleReceipt)
├── views/        # Top-level Page components (e.g., POSView.tsx)
└── index.ts      # Public API for this feature (Strict Barrier)
```

## The Golden Rule (Strict Encapsulation)
Other features may **ONLY** import from a feature's `index.ts` file. You may NEVER deep-import a component from another feature's internal folders. If a component is needed across multiple features, it belongs in `/src/components/shared`.
