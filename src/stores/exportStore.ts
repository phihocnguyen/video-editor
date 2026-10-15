import { create } from "zustand";
import type { ExportJobStatus } from "../lib/tauri";

export type ExportJob = ExportJobStatus & { downloadUrl?: string | null };

interface ExportState {
  job: ExportJob | null;
  setJob: (job: ExportJob | null) => void;
  clearJob: () => void;
}

export const useExportStore = create<ExportState>((set) => ({
  job: null,
  setJob: (job) => set({ job }),
  clearJob: () => set({ job: null }),
}));
