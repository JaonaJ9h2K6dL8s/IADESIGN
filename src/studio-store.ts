import { create } from 'zustand';
import { createStarterProject } from './product-templates';
import type { DesignProject } from './types';

type ProjectUpdate = DesignProject | ((project: DesignProject) => DesignProject);
export type StudioCheckpoint = { project: DesignProject; selected: string[]; historyPast: DesignProject[]; historyFuture: DesignProject[] };

type StudioState = {
  project: DesignProject;
  selected: string[];
  historyPast: DesignProject[];
  historyFuture: DesignProject[];
  setProject: (update: ProjectUpdate) => void;
  loadProject: (project: DesignProject) => void;
  setSelected: (selected: string[]) => void;
  undo: () => void;
  redo: () => void;
};

export const useStudioStore = create<StudioState>((set) => ({
  project: createStarterProject(),
  selected: [],
  historyPast: [],
  historyFuture: [],
  setProject: (update) => set((state) => {
    const next = typeof update === 'function' ? update(state.project) : update;
    if (next === state.project) return state;
    return { project: next, historyPast: [...state.historyPast, state.project].slice(-100), historyFuture: [] };
  }),
  loadProject: (project) => set({ project, historyPast: [], historyFuture: [] }),
  setSelected: (selected) => set({ selected }),
  undo: () => set((state) => {
    const previous = state.historyPast.at(-1);
    if (!previous) return state;
    return { project: previous, historyPast: state.historyPast.slice(0, -1), historyFuture: [...state.historyFuture, state.project].slice(-100) };
  }),
  redo: () => set((state) => {
    const next = state.historyFuture.at(-1);
    if (!next) return state;
    return { project: next, historyPast: [...state.historyPast, state.project].slice(-100), historyFuture: state.historyFuture.slice(0, -1) };
  }),
}));

export function captureStudioCheckpoint(): StudioCheckpoint {
  const { project, selected, historyPast, historyFuture } = useStudioStore.getState();
  return structuredClone({ project, selected, historyPast, historyFuture });
}

export function restoreStudioCheckpoint(checkpoint: StudioCheckpoint) {
  useStudioStore.setState(structuredClone(checkpoint));
}
