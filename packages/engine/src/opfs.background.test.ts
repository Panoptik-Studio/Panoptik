import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Segment } from "@panoptik/schema";

/**
 * How background images are stored.
 *
 * Two things here are easy to get wrong and expensive when wrong: writing one
 * copy per segment when a picture is applied to every clip, and leaving files
 * behind once a segment stops using them. Both quietly grow browser storage,
 * which is the failure this project has already hit once.
 */

/** A minimal OPFS: a flat map of file name to bytes, per project directory. */
function mockOpfs() {
  const dirs = new Map<string, Map<string, Blob>>();

  const dirHandle = (name: string) => {
    if (!dirs.has(name)) dirs.set(name, new Map());
    const files = dirs.get(name)!;
    return {
      kind: "directory" as const,
      getFileHandle: async (fileName: string, opts?: { create?: boolean }) => {
        if (!files.has(fileName) && !opts?.create) throw new Error("not found");
        return {
          createWritable: async () => ({
            write: async (data: Blob | string) => {
              files.set(fileName, typeof data === "string" ? new Blob([data]) : data);
            },
            close: async () => {} }),
          getFile: async () => {
            const f = files.get(fileName);
            if (!f) throw new Error("not found");
            return f;
          } };
      },
      removeEntry: async (fileName: string) => {
        if (!files.has(fileName)) throw new Error("not found");
        files.delete(fileName);
      },
      // listProjectSummaries walks each project directory to sum sizes and
      // spot the poster and exported markers.
      entries: async function* () {
        for (const [fileName, blob] of files) {
          yield [
            fileName,
            { kind: "file" as const, getFile: async () => blob } ] as const;
        }
      } };
  };

  return {
    dirs,
    root: {
      getDirectoryHandle: async (name: string) => dirHandle(name),
      entries: async function* () {
        for (const name of dirs.keys()) {
          yield [name, { ...dirHandle(name), kind: "directory" as const }] as const;
        }
      } } };
}

const segment = (over: Partial<Segment> = {}): Segment => ({
  id: "s",
  mediaId: "m1",
      srcStart: 0,
  srcEnd: 10,
  speed: 1,
  stagePadding: 0,
  aspectPreset: "16:9",
  background: { kind: "solid", color: "#000000" },
  facecam: { src: "", x: 0.8, y: 0.8, size: 0.2, shape: "circle" },
  zoomPoints: [],
  stagedZoomPoints: [],
  textOverlays: [],
  stagedTextOverlays: [], ...over });

const project = (segments: Segment[]): Project => ({
  id: "proj",
  media: [{ id: "m1", src: "blob:clip", duration: 10, width: 1920, height: 1080 }],
  segments,
  clickLog: [] });

let fs: ReturnType<typeof mockOpfs>;

beforeEach(() => {
  fs = mockOpfs();
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => fs.root } });
  // Every blob: URL resolves to a body whose size encodes the URL, so the
  // "skip rewriting an unchanged file" check has something to compare.
  vi.stubGlobal("fetch", async (url: string) => ({
    blob: async () => new Blob(["x".repeat(url.length)]) }));
});

afterEach(() => vi.unstubAllGlobals());

const namesIn = (id: string) => [...(fs.dirs.get(id)?.keys() ?? [])].filter((n) => n.startsWith("bg-"));

describe("project summaries", () => {
  it("reports drafts until a project is exported, then stops", async () => {
    const { saveProject, listProjectSummaries, markExported } = await import("./opfs");
    await saveProject(project([segment()]), false);

    let [summary] = await listProjectSummaries();
    // Nothing exported yet, so the library shows it as a draft.
    expect(summary!.exportedAt).toBeNull();

    await markExported("proj");
    [summary] = await listProjectSummaries();
    expect(typeof summary!.exportedAt).toBe("number");
  });

  it("carries what the grid needs without opening the media", async () => {
    const { saveProject, listProjectSummaries } = await import("./opfs");
    await saveProject(project([segment()]), false);

    const [summary] = await listProjectSummaries();
    expect(summary).toMatchObject({ id: "proj", duration: 10, width: 1920, height: 1080 });
    // Size is summed from the files actually on disk.
    expect(summary!.bytes).toBeGreaterThan(0);
    expect(summary!.hasPoster).toBe(false);
  });

  it("keeps a poster once one has been generated", async () => {
    const { saveProject, savePoster, loadPoster, listProjectSummaries } = await import("./opfs");
    await saveProject(project([segment()]), false);
    await savePoster("proj", new Blob(["jpeg-bytes"]));

    expect(await loadPoster("proj")).toBeTruthy();
    const [summary] = await listProjectSummaries();
    expect(summary!.hasPoster).toBe(true);
  });
});

describe("background image storage", () => {
  it("writes one file per distinct image, not one per segment", async () => {
    const { saveProject } = await import("./opfs");
    // The same picture applied to all three clips.
    await saveProject(
      project([
        segment({ id: "a", background: { kind: "image", src: "blob:pic", fit: "cover" } }),
        segment({ id: "b", background: { kind: "image", src: "blob:pic", fit: "cover" } }),
        segment({ id: "c", background: { kind: "image", src: "blob:pic", fit: "contain" } }) ]),
      false,
    );
    expect(namesIn("proj")).toEqual(["bg-0.bin"]);
  });

  it("keeps a separate file for each different image", async () => {
    const { saveProject } = await import("./opfs");
    await saveProject(
      project([
        segment({ id: "a", background: { kind: "image", src: "blob:one", fit: "cover" } }),
        segment({ id: "b", background: { kind: "image", src: "blob:twoo", fit: "cover" } }) ]),
      false,
    );
    expect(namesIn("proj")).toEqual(["bg-0.bin", "bg-1.bin"]);
  });

  it("removes the file once a segment stops using an image", async () => {
    const { saveProject } = await import("./opfs");
    const withImage = project([
      segment({ id: "a", background: { kind: "image", src: "blob:pic", fit: "cover" } }) ]);
    await saveProject(withImage, false);
    expect(namesIn("proj")).toEqual(["bg-0.bin"]);

    // The user picks a colour theme instead.
    await saveProject(
      project([segment({ id: "a", background: { kind: "solid", color: "#101010" } })]),
      false,
    );
    expect(namesIn("proj")).toEqual([]);
  });

  it("stores the image even when media is not being copied", async () => {
    // Media is only copied on a project's first save, but a background is
    // chosen long after that. Gating the image behind includeMedia meant it was
    // never written and vanished on reload.
    const { saveProject } = await import("./opfs");
    await saveProject(
      project([segment({ background: { kind: "image", src: "blob:pic", fit: "cover" } })]),
      /* includeMedia */ false,
    );
    expect(namesIn("proj")).toEqual(["bg-0.bin"]);
  });

  it("hands segments that shared an image the very same blob on load", async () => {
    const { saveProject, loadProjectRecord } = await import("./opfs");
    await saveProject(
      project([
        segment({ id: "a", background: { kind: "image", src: "blob:pic", fit: "cover" } }),
        segment({ id: "b", background: { kind: "image", src: "blob:pic", fit: "cover" } }) ]),
      false,
    );

    const rec = await loadProjectRecord("proj");
    const imgs = rec?.backgroundImages ?? [];
    expect(imgs[0]).toBeTruthy();
    // Same object, so the caller mints one object URL rather than two.
    expect(imgs[1]).toBe(imgs[0]);
  });

  it("roundtrips multiple media files (multiclip)", async () => {
    const { saveProject, loadProjectRecord } = await import("./opfs");
    const two = project([
      segment(),
      segment({ id: "s2", mediaId: "m2" }) ]);
    two.media.push({ id: "m2", src: "blob:other", duration: 5, width: 1280, height: 720 });
    await saveProject(two, true);

    const rec = await loadProjectRecord("proj");
    expect(rec?.mediaFiles?.length).toBe(2);
    expect(rec?.mediaFiles?.[0]).toBeTruthy();
    expect(rec?.mediaFiles?.[1]).toBeTruthy();
  });
});
