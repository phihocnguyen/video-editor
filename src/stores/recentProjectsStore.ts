import { create } from "zustand";

export interface RecentProjectEntry {
  path: string;
  name: string;
  openedAt: string;
}

const STORAGE_KEY = "klipcut.recentProjects";
const MAX_RECENT = 12;

function loadRecent(): RecentProjectEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentProjectEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(entries: RecentProjectEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENT)));
  } catch {
    /* ignore quota */
  }
}

interface RecentProjectsState {
  recent: RecentProjectEntry[];
  remember: (path: string, name: string) => void;
  remove: (path: string) => void;
  clear: () => void;
}

export const useRecentProjectsStore = create<RecentProjectsState>((set, get) => ({
  recent: typeof window !== "undefined" ? loadRecent() : [],
  remember: (path, name) => {
    const next = [
      { path, name, openedAt: new Date().toISOString() },
      ...get().recent.filter((e) => e.path !== path),
    ].slice(0, MAX_RECENT);
    saveRecent(next);
    set({ recent: next });
  },
  remove: (path) => {
    const next = get().recent.filter((e) => e.path !== path);
    saveRecent(next);
    set({ recent: next });
  },
  clear: () => {
    saveRecent([]);
    set({ recent: [] });
  },
}));
