import { describe, expect, it } from "vitest";
import type { Project } from "@panoptik/schema";
import { blobToDataUrl, dataUrlToBlob, exportProjectBundle, importProjectBundle } from "./projectPackage";

describe("projectPackage", () => {
  it("converts Blobs to data URLs and back to Blobs faithfully", async () => {
    const text = "Hello Panoptik Project Data!";
    const originalBlob = new Blob([text], { type: "text/plain" });

    const dataUrl = await blobToDataUrl(originalBlob);
    expect(dataUrl.startsWith("data:text/plain;base64,")).toBe(true);

    const recoveredBlob = dataUrlToBlob(dataUrl);
    expect(recoveredBlob.type).toBe("text/plain");
    expect(await recoveredBlob.text()).toBe(text);
  });

  it("exports project package bundle structure with proper metadata", async () => {
    const project: Project = {
      id: "test-proj-1",
      name: "Demo Project",
      width: 1920,
      height: 1080,
      media: [{ id: "m1", src: "blob:http://localhost/test", duration: 60, width: 1920, height: 1080 }],
      segments: [
        {
          id: "seg-1",
          mediaId: "m1",
          srcStart: 0,
          srcEnd: 60,
          speed: 1,
          stagePadding: 0,
          aspectPreset: "source",
          background: { kind: "solid", color: "#000" },
          facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
          zoomPoints: [{ id: "z1", t: 10, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.35 }],
          stagedZoomPoints: [],
          textOverlays: [{ id: "t1", timestamp: 5, duration: 3, text: "Welcome", position: "top" }],
          stagedTextOverlays: [],
        },
      ],
      clickLog: [],
    };

    const { bundle, filename } = await exportProjectBundle(project);
    expect(bundle.format).toBe("panoptik-project");
    expect(bundle.version).toBe(1);
    expect(bundle.project.name).toBe("Demo Project");
    expect(filename).toBe("Demo_Project.panoptik");
  });
});
