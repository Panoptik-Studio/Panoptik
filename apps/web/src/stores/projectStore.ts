/**
 * OWNER: DEV B — minimal compiling shell so the app runs on Day 1.
 * Expand to the FULL Spec.md §B1 shape (+ deltas listed in ROADMAP-B.md)
 * in Task 1.2 via TDD: staged* arrays, history/undo/redo, getStagedDiff,
 * commitAll, removeStaged*, markMoment, pendingBackgroundBadge,
 * selectedZoomId + setSelectedZoom(id | null)  ← consumed by DEV A's Inspector.
 */
"use client"; // not required by zustand itself; keeps future hook usage simple

import { create } from "zustand";
import type { Project } from "@panoptik/schema";

interface ProjectStore {
  project: Project | null;
  setProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  project: null,
  setProject: (project) => set({ project }),
}));
