import { create } from 'zustand';

interface JobState {
  generatingSessionId: string | null;
  setGeneratingSession: (id: string | null) => void;
}

export const useJobStore = create<JobState>((set) => ({
  generatingSessionId: null,
  setGeneratingSession: (id) => set({ generatingSessionId: id }),
}));
