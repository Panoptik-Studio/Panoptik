import { beforeEach, describe, expect, it } from "vitest";
import { forgetMediaSaved, markMediaSaved, needsMediaCopy } from "./useProjectPersistence";

/**
 * Copying media means re-fetching the blob URLs and rewriting the video into
 * OPFS, so this decision has to be right. It used to live in a per-component
 * ref: the editor held one copy and the Media panel another, and the panel's
 * started empty — so every time that tab mounted it concluded the open project
 * was new and re-copied the whole video. That is what grew browser storage.
 */
describe("needsMediaCopy", () => {
  beforeEach(() => forgetMediaSaved());

  it("says yes the first time a project is seen", () => {
    expect(needsMediaCopy("proj-a")).toBe(true);
  });

  it("says no once that project's media is on disk", () => {
    markMediaSaved("proj-a");
    expect(needsMediaCopy("proj-a")).toBe(false);
  });

  it("is shared, so a second consumer agrees with the first", () => {
    // The editor saves the media...
    markMediaSaved("proj-a");
    // ...and the Media panel, mounting later, must not decide to redo it.
    expect(needsMediaCopy("proj-a")).toBe(false);
  });

  it("still copies media for a different project", () => {
    markMediaSaved("proj-a");
    expect(needsMediaCopy("proj-b")).toBe(true);
  });

  it("copies again after the project is deleted and reimported", () => {
    markMediaSaved("proj-a");
    forgetMediaSaved();
    expect(needsMediaCopy("proj-a")).toBe(true);
  });
});
