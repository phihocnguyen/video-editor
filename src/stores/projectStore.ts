import { create } from "zustand";
import { createEmptyProject, type ProjectDocument } from "../domain";

interface ProjectState {
  project: ProjectDocument;
  dirty: boolean;
  setProject: (project: ProjectDocument) => void;
  newProject: (name?: string) => void;
  markClean: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: createEmptyProject(),
  dirty: false,
  setProject: (project) => set({ project, dirty: true }),
  newProject: (name) => set({ project: createEmptyProject(name), dirty: false }),
  markClean: () => set({ dirty: false }),
}));
