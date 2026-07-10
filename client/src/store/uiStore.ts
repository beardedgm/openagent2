import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  // Closed by default on narrow viewports; 880px matches the DESIGN.md §7 collapse breakpoint.
  sidebarOpen: typeof window === 'undefined' ? true : window.innerWidth > 880,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
