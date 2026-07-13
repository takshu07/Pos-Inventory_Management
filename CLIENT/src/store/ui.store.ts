import { create } from "zustand";

/**
 * UI Store — Global client-side UI state
 * Responsibility: Manages shell-level UI (sidebar open/collapsed) only.
 * This is NOT for server data. Server data belongs in TanStack Query.
 */

interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleCollapsed: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,        // Mobile: drawer open/closed
  sidebarCollapsed: false,  // Desktop: icon-only vs full sidebar
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
