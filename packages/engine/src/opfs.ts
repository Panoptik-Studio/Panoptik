/**
 * OWNER: DEV B — ROADMAP-B.md Task 2.5. OPFS project persistence.
 * Layout under navigator.storage.getDirectory():
 *   <project.id>/project.json · clip.webm · facecam.webm (optional)
 * Signatures:
 *   saveProject(project: Project): Promise<void>
 *   loadProject(id: string): Promise<Project | null>   // restores blob URLs from OPFS
 *   listProjects(): Promise<{ id: string; name: string }[]>
 * Degrade gracefully off secure context (return null / []).
 * Re-export via the B-region in index.ts.
 */
export {};
