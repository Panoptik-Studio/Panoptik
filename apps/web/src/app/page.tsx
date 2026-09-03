"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// Gift4Day tokens adapted for Panoptik — no images from reference, just fonts/padding/tokens

/** youtu.be/naWZF9vwZDE — the hero demo reel. */
const DEMO_VIDEO_ID = "naWZF9vwZDE";

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [leftPos, setLeftPos] = useState({ x: 0, y: 0 });
  const [rightPos, setRightPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuOpen) return;
      if (menuRef.current && btnRef.current && !menuRef.current.contains(e.target as Node) && !btnRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setMenuOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      if (dragging === "left") setLeftPos({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy });
      else if (dragging === "right") setRightPos({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy });
    }
    function onUp() { setDragging(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging]);

  return (
    <>
      <style>{`
        /* Fonts, base typography and the --font-* aliases live in globals.css
           so the editor shares them. */
        * { box-sizing: border-box; }
        body { overflow-x: clip; }
        .page-bg { background: #F8F8F8; min-height: 100vh; }
        .container { max-width: 1300px; margin: 0 auto; padding: 0 40px; }
        @media (max-width: 768px) { .container { padding: 0 24px; } }
        @media (max-width: 480px) { .container { padding: 0 16px; } }

        /* Demo video facade */
        .video-facade img { transition: transform 0.5s ease, filter 0.4s ease; }
        .video-facade:hover img { transform: scale(1.03); filter: brightness(1.06); }
        .video-play { transition: transform 0.25s ease, background 0.2s ease, box-shadow 0.25s ease; }
        .video-facade:hover .video-play { transform: translate(-50%, -50%) scale(1.09); background: #1F1F1F; box-shadow: 0 12px 40px rgba(0,0,0,0.45); }
        .video-facade:focus-visible { outline: 3px solid #0070f3; outline-offset: 3px; }
        @media (prefers-reduced-motion: reduce) {
          .video-facade img, .video-play { transition: none; }
          .video-facade:hover img { transform: none; }
          .video-facade:hover .video-play { transform: translate(-50%, -50%); }
        }
      `}</style>

      <div className="page-bg">
        {/* Navbar — Gift4Day pattern */}
        <header style={{ position: "sticky", top: 0, zIndex: 100, width: "100%", background: "#F8F8F8", paddingTop: 22, paddingBottom: 10 }}>
          <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 90, paddingLeft: 20, paddingRight: 40 }}>
            <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", flexShrink: 0 }}>
              <span style={{ width: 60, height: 60, borderRadius: 11, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", border: "1px solid #ebebeb" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/favicon-logo.webp" alt="" width={36} height={36} style={{ objectFit: "contain" }} />
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/text-logo-dark.webp" alt="Panoptik" width={140} height={34} style={{ height: 34, width: "auto", objectFit: "contain" }} />
            </a>
            <nav style={{ display: "flex" }} className="hidden md:flex">
              <ul style={{ display: "flex", alignItems: "center", gap: 56, listStyle: "none", margin: 0, padding: 0 }}>
                {[
                  { label: "How it works", href: "#how" },
                  { label: "My clips", href: "/projects" },
                  { label: "Editor", href: "/editor" },
                  { label: "FAQ", href: "#faq" },
                ].map((l) => (
                  <li key={l.label}><a href={l.href} style={{ fontFamily: "var(--font-poppins)", fontSize: 24, fontWeight: 400, color: "#1A1A1A", textDecoration: "none", transition: "color 0.15s" }} onMouseEnter={(e) => (e.currentTarget.style.color = "#0070f3")} onMouseLeave={(e) => (e.currentTarget.style.color = "#1A1A1A")}>{l.label}</a></li>
                ))}
              </ul>
            </nav>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Link href="/editor" style={{ padding: "12px 40px", background: "#1f1f1f", color: "#fff", fontFamily: "var(--font-poppins)", fontSize: 16, fontWeight: 700, borderRadius: 13, textDecoration: "none", transition: "background 0.15s" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#0070f3")} onMouseLeave={(e) => (e.currentTarget.style.background = "#1f1f1f")}>Open editor</Link>
              <div style={{ display: "none" }} className="mobile-only">
                <button ref={btnRef} onClick={() => setMenuOpen((s) => !s)} aria-label={menuOpen ? "Close" : "Open"} style={{ width: 48, height: 48, background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ display: "block", width: 22, height: 2, background: menuOpen ? "transparent" : "#000", position: "relative", transition: "all 0.18s" }}>
                    <span style={{ content: '""', position: "absolute", left: 0, right: 0, height: 2, background: "#000", top: menuOpen ? 0 : -7, transform: menuOpen ? "rotate(45deg)" : "none", transition: "all 0.18s" }} />
                    <span style={{ content: '""', position: "absolute", left: 0, right: 0, height: 2, background: "#000", top: menuOpen ? 0 : 7, transform: menuOpen ? "rotate(-45deg)" : "none", transition: "all 0.18s" }} />
                  </span>
                </button>
                {menuOpen && (
                  <div ref={menuRef} style={{ position: "absolute", right: 16, top: 78, width: 220, background: "#F8F8F8", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 8, zIndex: 200 }}>
                    <a href="#how" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "10px 12px", fontFamily: "var(--font-poppins)", color: "#1A1A1A", textDecoration: "none" }}>How it works</a>
                    <a href="/projects" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "10px 12px", fontFamily: "var(--font-poppins)", color: "#1A1A1A", textDecoration: "none" }}>My clips</a>
                    <a href="/editor" onClick={() => setMenuOpen(false)} style={{ display: "block", padding: "10px 12px", fontFamily: "var(--font-poppins)", color: "#1A1A1A", textDecoration: "none" }}>Editor</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Hero — constant 80px like other sections */}
        <section style={{ background: "#F8F8F8", padding: "80px 0", overflow: "hidden", overflowX: "clip" }}>
          <div className="container" style={{ maxWidth: 1300, margin: "0 auto", padding: "0 clamp(16px, 3vw, 40px)" }}>
            <div style={{ textAlign: "center", position: "relative", paddingBottom: "clamp(40px, 6vw, 80px)" }}>
              {/* Toast left — draggable */}
              <div
                onMouseDown={(e) => { setDragging("left"); dragStart.current = { x: e.clientX, y: e.clientY, ox: leftPos.x, oy: leftPos.y }; }}
                style={{ position: "absolute", left: "clamp(-30px, -1.6vw, -10px)", top: "clamp(80px, 10vw, 130px)", display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 13, padding: "16px 24px", boxShadow: "0 8px 30px rgba(0,0,0,0.1)", transform: `rotate(-6deg) translate(${leftPos.x}px, ${leftPos.y}px)`, width: "clamp(260px, 28vw, 360px)", cursor: dragging === "left" ? "grabbing" : "grab", userSelect: "none", touchAction: "none" }} className="hidden lg:flex">
                <span style={{ width: 44, height: 44, borderRadius: 100, background: "#0070f3", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800 }}>A</span>
                <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                  <strong style={{ fontFamily: "var(--font-poppins)", fontSize: 14, fontWeight: 500, color: "#111" }}>Agent staged 2 zooms</strong>
                  <span style={{ fontFamily: "var(--font-poppins)", fontSize: 12, color: "#888" }}>at 3.2s and 7.8s • review → commit</span>
                </span>
              </div>

              <h1 style={{ maxWidth: 760, margin: "0 auto clamp(14px, 2vw, 24px)", fontFamily: "var(--font-poppins)", fontSize: "clamp(32px, 5.5vw, 72px)", fontWeight: 600, lineHeight: "120%", letterSpacing: 0, textAlign: "center", color: "#1F1F1F" }}>
                <span style={{ display: "block" }}>Simplifying <span style={{ fontFamily: "var(--font-lato)", fontStyle: "italic", fontWeight: 900 }}>Recording,</span></span>
                <span style={{ display: "block" }}><span style={{ fontFamily: "var(--font-lato)", fontStyle: "italic", fontWeight: 900 }}>Amplifying</span> Story.</span>
              </h1>
              <p style={{ maxWidth: 680, margin: "0 auto clamp(20px, 3vw, 36px)", fontFamily: "var(--font-poppins)", fontWeight: 300, fontSize: "clamp(15px, 2vw, 20px)", lineHeight: "140%", textAlign: "center", color: "#1F1F1F" }}>
                Plan, record &amp; co-edit with your AI agent. Screen + camera, zoom-to-point and export — all in your browser, no upload.
              </p>
              <Link href="/editor" style={{ width: "clamp(220px, 22vw, 277px)", height: "clamp(44px, 4vw, 52px)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#1F1F1F", color: "#fff", textDecoration: "none", borderRadius: 13, padding: "12px 40px", fontSize: "clamp(15px, 1.5vw, 18px)", fontWeight: 500, fontFamily: "var(--font-poppins)", transition: "background 0.15s" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#0070f3")} onMouseLeave={(e) => (e.currentTarget.style.background = "#1F1F1F")}>
                <span style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.14)", borderRadius: 6, fontSize: 16, lineHeight: 1 }}>+</span>
                <span>Start for free</span>
              </Link>
              <div style={{ marginTop: 18, display: "flex", justifyContent: "center", alignItems: "center", gap: 14, fontFamily: "var(--font-poppins)", fontSize: 12, color: "#666" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ color: "#10b981", fontWeight: 700 }}>✓</span> No upload</span>
                <span style={{ width: 1, height: 14, background: "#ebebeb" }} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ color: "#10b981", fontWeight: 700 }}>✓</span> WebMCP tools</span>
                <span style={{ width: 1, height: 14, background: "#ebebeb" }} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ color: "#10b981", fontWeight: 700 }}>✓</span> 100% local</span>
              </div>

              {/* Toast right — draggable */}
              <div
                onMouseDown={(e) => { setDragging("right"); dragStart.current = { x: e.clientX, y: e.clientY, ox: rightPos.x, oy: rightPos.y }; }}
                style={{ position: "absolute", right: "clamp(-20px, -1.6vw, -10px)", bottom: "clamp(150px, 18vw, 240px)", display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 13, padding: "16px 24px", boxShadow: "0 8px 30px rgba(0,0,0,0.1)", transform: `rotate(6deg) translate(${rightPos.x}px, ${rightPos.y}px)`, width: "clamp(260px, 28vw, 360px)", cursor: dragging === "right" ? "grabbing" : "grab", userSelect: "none", touchAction: "none" }} className="hidden lg:flex">
                <span style={{ width: 44, height: 44, borderRadius: 100, background: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800 }}>✓</span>
                <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                  <strong style={{ fontFamily: "var(--font-poppins)", fontSize: 14, fontWeight: 500, color: "#111" }}>Edits staged</strong>
                  <span style={{ fontFamily: "var(--font-poppins)", fontSize: 12, color: "#888" }}>12 segments · commit to apply</span>
                </span>
              </div>
            </div>

            {/* Demo video — framed in the same browser chrome as the editor */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginTop: "clamp(-20px, -2vw, -10px)", marginBottom: "clamp(-20px, -2vw, -10px)" }}>
              <div style={{ width: "clamp(280px, 78vw, 1080px)", borderRadius: 16, background: "#111", border: "6px solid #fff", boxShadow: "0 24px 64px rgba(0,0,0,0.18)", overflow: "hidden", position: "relative", zIndex: 2 }}>
                <div style={{ height: 28, background: "#1a1c21", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 6, padding: "0 10px" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: "#ef4444" }} /><span style={{ width: 8, height: 8, borderRadius: 999, background: "#f59e0b" }} /><span style={{ width: 8, height: 8, borderRadius: 999, background: "#10b981" }} />
                  <span style={{ marginLeft: 8, fontFamily: "var(--font-poppins)", fontSize: 10, color: "#888" }}>panoptik — watch the demo</span>
                </div>
                {/* Click-to-play facade: the YouTube player (~1MB) only loads once
                    the visitor asks for it, so it never slows the first paint. */}
                <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
                  {videoPlaying ? (
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${DEMO_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                      title="Panoptik demo"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, display: "block" }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setVideoPlaying(true)}
                      aria-label="Play the Panoptik demo video"
                      className="video-facade"
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, border: 0, background: "#000", cursor: "pointer", display: "block", overflow: "hidden" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://i.ytimg.com/vi/${DEMO_VIDEO_ID}/maxresdefault.jpg`}
                        alt=""
                        loading="lazy"
                        onError={(e) => { e.currentTarget.src = `https://i.ytimg.com/vi/${DEMO_VIDEO_ID}/hqdefault.jpg`; }}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                      {/* Scrim keeps the play button readable over any frame */}
                      <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.34) 100%)" }} />
                      <span className="video-play" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "clamp(64px, 7vw, 88px)", height: "clamp(64px, 7vw, 88px)", borderRadius: 999, background: "#0070f3", display: "grid", placeItems: "center", boxShadow: "0 10px 34px rgba(0,112,243,0.45)" }}>
                        <svg width="30%" height="30%" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" /></svg>
                      </span>
                      <span style={{ position: "absolute", left: "clamp(16px, 2vw, 28px)", bottom: "clamp(16px, 2vw, 28px)", display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.94)", borderRadius: 100, padding: "8px 16px", fontFamily: "var(--font-poppins)", fontSize: "clamp(11px, 1.1vw, 13px)", fontWeight: 500, color: "#1F1F1F", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: "#ef4444" }} />
                        Watch the demo
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works — arrow flow, pipeline detail, capability chips */}
        <section id="how" style={{ background: "#F8F8F8", padding: "80px 0" }}>
          <div className="container" style={{ paddingTop: 8, paddingBottom: 8 }}>
            <style>{`
              .how-grid { scrollbar-width: none; scroll-snap-type: x proximity; }
              .how-grid::-webkit-scrollbar { display: none; }
              .how-arrow { width: 60px; height: 80px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin-top: 96px; opacity: 0.9; }
              .how-card { flex: 1 1 300px; max-width: 360px; min-width: 280px; background: #fff; border: 1px solid #ebebeb; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; box-shadow: 0 2px 12px rgba(0,0,0,0.04); scroll-snap-align: center; transition: box-shadow 0.25s, transform 0.25s, border-color 0.25s; }
              .how-card:hover { box-shadow: 0 12px 32px rgba(0,0,0,0.09); transform: translateY(-3px); border-color: #d3e5ff; }
              .how-spec { display: flex; gap: 8px; align-items: flex-start; font-family: var(--font-nunito); font-size: 12.5px; line-height: 155%; color: #666; }
              .how-spec svg { flex-shrink: 0; margin-top: 3px; }
              .how-deep { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; max-width: 1100px; margin: 40px auto 0; }
              .how-deep-card { background: #fff; border: 1px solid #ebebeb; border-radius: 16px; padding: 20px; transition: border-color 0.25s, box-shadow 0.25s; }
              .how-deep-card:hover { border-color: #d3e5ff; box-shadow: 0 8px 24px rgba(0,0,0,0.06); }
              .how-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 1000px; margin: 32px auto 0; }
              @media (max-width: 1100px) { .how-grid { flex-wrap: wrap; gap: 20px; justify-content: center; padding: 12px 24px; max-width: 100%; } .how-arrow { display: none !important; } .how-deep { grid-template-columns: repeat(2, 1fr); } }
              @media (max-width: 768px) { .how-grid { flex-direction: column; align-items: center; gap: 20px; padding: 12px 16px; } .how-arrow { display: none !important; } .how-deep { grid-template-columns: 1fr; } }
            `}</style>

            <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14, marginBottom: 40, padding: "0 12px" }}>
              <span style={{ fontFamily: "var(--font-poppins)", fontSize: 12, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#0070f3" }}>— How it works —</span>
              <h2 style={{ fontFamily: "var(--font-lato)", fontWeight: 800, fontSize: "clamp(26px, 4.6vw, 60px)", lineHeight: "120%", color: "#1A1A1A" }}>How It <em style={{ fontFamily: "var(--font-alkatra)", fontWeight: 700, fontStyle: "normal" }}>Works</em>?</h2>
              <p style={{ fontFamily: "var(--font-poppins)", fontWeight: 300, fontSize: 16, color: "#424242", lineHeight: "160%", maxWidth: 580, margin: "0 auto" }}>
                Record or import, edit it yourself or hand the first pass to an agent, review every change before it lands, and export. The preview you approve is the file you get.
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "flex-start", gap: 20, overflowX: "auto", padding: "16px 32px 24px", maxWidth: "fit-content", margin: "0 auto" }} className="how-grid">
              {[
                {
                  n: "01", t: "Record or import", c: "#1F1F1F",
                  d: "Capture screen, webcam and microphone in a single take — or drop in an MP4, WebM or MOV you already have.",
                  specs: ["Screen, window or tab capture", "Circle or square camera, any corner", "3-2-1 countdown and built-in teleprompter", "Screen and camera kept as separate tracks"],
                  tags: ["Screen", "Webcam", "Mic", "Teleprompter"],
                },
                {
                  n: "02", t: "Edit, or delegate it", c: "#0070f3",
                  d: "Do it by hand, or let an agent take the first pass. Through WebMCP it reads the real project and calls typed tools — no screenshot guesswork.",
                  specs: ["propose_zoom_points, set_background", "add_text_overlay", "Proposals arrive as dashed ghosts on the timeline", "Nothing is committed without your approval"],
                  tags: ["WebMCP", "Staged", "Ghosts", "ToolTrace"],
                },
                {
                  n: "03", t: "Review and export", c: "#10b981",
                  d: "Open the staged diff, keep what you want, and the ghosts turn solid. One renderer draws both the preview and the finished file.",
                  specs: ["Undo and redo across every kind of edit", "Preview and export share one render path", "1080p MP4 (H.264) or WebM (VP9)", "Saved on device, reopens where you left it"],
                  tags: ["Diff", "History", "MP4", "WebM"],
                },
              ].map((c, idx) => (
                <div key={c.n} style={{ display: "contents" }}>
                  <div className="how-card">
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 36, height: 36, borderRadius: 100, background: c.c, color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-poppins)", fontWeight: 700, fontSize: 13 }}>{c.n}</span>
                      <span style={{ fontFamily: "var(--font-poppins)", fontWeight: 600, fontSize: 16.5, color: "#1A1A1A" }}>{c.t}</span>
                    </div>
                    <p style={{ fontFamily: "var(--font-nunito)", fontSize: 13.5, lineHeight: "162%", color: "#555", margin: 0 }}>{c.d}</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
                      {c.specs.map((sp) => (
                        <span key={sp} className="how-spec">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={c.c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          {sp}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto", paddingTop: 10 }}>
                      {c.tags.map((tag) => (
                        <span key={tag} style={{ background: c.n === "02" ? "#d3e5ff" : "#f1f1f1", border: `1px solid ${c.n === "02" ? "#0070f3" : "#ebebeb"}`, borderRadius: 100, padding: "4px 10px", fontFamily: "var(--font-poppins)", fontSize: 10, color: c.n === "02" ? "#0070f3" : "#666" }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                  {idx < 2 && (
                    <div className="how-arrow" aria-hidden>
                      <svg width="60" height="80" viewBox="0 0 60 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M0,60 C 30,60 20,20 55,20" stroke="#8A92A6" strokeWidth="3" fill="transparent" strokeLinecap="round" />
                        <path d="M45,10 L 56,20 L 45,30" stroke="#8A92A6" strokeWidth="3" fill="transparent" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Under the hood — the parts that are genuinely unusual */}
            <div style={{ textAlign: "center", marginTop: 48 }}>
              <span style={{ fontFamily: "var(--font-poppins)", fontSize: 11, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#888" }}>Under the hood</span>
            </div>
            <div className="how-deep">
              {[
                { k: "Capture", v: "MediaRecorder, with a hardware VP9 path through WebCodecs when the machine offers one. Encoding starts after the countdown, so takes do not open on dead footage." },
                { k: "Decode", v: "mediabunny drives WebCodecs through a coalesced frame pump — one forward sweep rather than a seek per frame, which is what keeps scrubbing smooth on long recordings." },
                { k: "Compose", v: "Background, zoom, camera bubble and text are drawn in a single pass. Preview and export call the same function, so the two cannot drift apart." },
                { k: "Persist", v: "Projects live in the browser's own file system. Media is written once, edits autosave as JSON, and your last project reopens when you come back." },
              ].map((d) => (
                <div key={d.k} className="how-deep-card">
                  <p style={{ fontFamily: "var(--font-poppins)", fontWeight: 600, fontSize: 13, color: "#1A1A1A", margin: "0 0 8px" }}>{d.k}</p>
                  <p style={{ fontFamily: "var(--font-nunito)", fontSize: 12.5, lineHeight: "160%", color: "#666", margin: 0 }}>{d.v}</p>
                </div>
              ))}
            </div>

            {/* What is actually in the editor */}
            <div className="how-chips">
              {["Zoom keyframes with easing", "Focal point drag", "Camera bubble, circle or square", "Speed 0.25×–3× without pitch shift", "Text overlays", "Solid, gradient or blurred backgrounds", "16:9 · 9:16 · 1:1 · 4:3 · source", "Undo and redo", "Export lock while rendering"].map((f) => (
                <span key={f} style={{ background: "#fff", border: "1px solid #ebebeb", borderRadius: 100, padding: "7px 14px", fontFamily: "var(--font-poppins)", fontSize: 11.5, color: "#555" }}>{f}</span>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ — constant 80px */}
        <section style={{ background: "#F8F8F8", padding: "80px 0" }}>
          <div style={{ maxWidth: 1300, margin: "0 auto", padding: "0 80px" }} className="faq-inner">
            <style>{`
              .faq-header { text-align: center; display: flex; flex-direction: column; gap: 22px; margin-bottom: clamp(40px, 7.7vw, 100px); }
              .faq-title { font-family: var(--font-alkatra); font-weight: 700; font-size: 60px; line-height: 1.2; color: #1A1A1A; }
              .faq-title em { font-style: normal; font-family: var(--font-alkatra); }
              .faq-subtitle { font-family: var(--font-poppins); font-weight: 300; font-size: 24px; line-height: 1.2; color: #666; }
              .faq-list { display: flex; flex-direction: column; gap: 16px; max-width: 1180px; margin: 0 auto; }
              .faq-item { background: #fff; border-radius: 20px; overflow: hidden; transition: box-shadow 0.2s; }
              .faq-item:hover { box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
              .faq-row { display: flex; justify-content: space-between; align-items: center; padding: 24px 32px; cursor: pointer; list-style: none; user-select: none; gap: 16px; }
              .faq-row::-webkit-details-marker { display: none; }
              .faq-question { font-family: var(--font-poppins); font-weight: 600; font-size: 22px; line-height: 1.3; color: #1A1A1A; }
              .faq-cat { flex-shrink: 0; font-family: var(--font-poppins); font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #0070f3; background: #d3e5ff; border-radius: 100px; padding: 5px 11px; }
              .faq-item[open] .faq-question { color: #0070f3; }
              .faq-chevron { width: 24px; height: 24px; flex-shrink: 0; color: #888; display: flex; align-items: center; justify-content: center; transition: transform 0.3s, color 0.3s; }
              .faq-chevron svg { width: 20px; height: 20px; }
              .faq-item[open] .faq-chevron { transform: rotate(180deg); color: #1A1A1A; }
              .faq-answer { padding: 0 32px 26px; max-width: 78ch; font-family: var(--font-nunito); font-size: 15.5px; line-height: 172%; color: #555; animation: faq-fade-in 0.4s cubic-bezier(0.4,0,0.2,1); }
              @keyframes faq-fade-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
              @media (max-width: 900px) { .faq-inner { padding: 0 24px; } .faq-title { font-size: 44px; } .faq-row { padding: 24px; } }
              @media (max-width: 900px) { .faq-cat { display: none; } }
              @media (max-width: 768px) { .faq-inner { padding: 0 16px; } .faq-title { font-size: 33px; } .faq-question { font-size: 17px; } .faq-answer { padding: 0 20px 18px; font-size: 14.5px; } }
            `}</style>
            <div className="faq-header">
              <h2 className="faq-title"><em>FAQs</em>?</h2>
              <p className="faq-subtitle">Everything worth knowing before you hit record.</p>
            </div>
            <div className="faq-list">
              {[
                { c: "Basics", q: "What is Panoptik?", a: "A demo studio that runs entirely in your browser. Record your screen and camera, edit on a real timeline — zoom keyframes, backgrounds, text — and export a finished MP4 or WebM. Nothing installs, nothing uploads." },
                { c: "Basics", q: "Do I need an AI agent to use it?", a: "No. Every tool is there in the editor and works on its own; the agent is an optional first pass, not the way in. If you never connect one, nothing about the app changes." },
                { c: "Agent", q: "What is WebMCP?", a: "Model Context Protocol, for the web. Rather than reading screenshots and guessing, a connected agent sees the actual project and calls typed tools — propose_zoom_points, set_background, add_text_overlay — with real arguments." },
                { c: "Agent", q: "Can the agent change my video without asking?", a: "No. Anything it proposes lands as a dashed ghost on the timeline and stays there until you approve it. You can retime a proposal by dragging it, discard it, or open ToolTrace to see exactly which call produced it." },
                { c: "Privacy", q: "Is anything uploaded?", a: "No, and there is nowhere for it to go — there is no server and no API key. Video decodes through WebCodecs and your recordings are written to the browser's own storage on your machine." },
                { c: "Privacy", q: "What happens to my camera and mic when I stop?", a: "They are released as soon as the take ends, and the hardware indicator goes out. The camera is only opened while the record panel is showing you a preview or a recording is running." },
                { c: "Editing", q: "How do zoom points work?", a: "Pause and click the preview to drop a zoom at the playhead, or let the agent propose a set. Drag the focal point to reframe, drag the diamonds on the timeline to retime, and the shot holds at that zoom until the next point takes over." },
                { c: "Editing", q: "Can I change the speed without chipmunk audio?", a: "Yes. Speed runs from 0.25× to 3×, and the audio is time-stretched rather than resampled, so voices keep their pitch. Preview and export are remapped through the same clock, so they stay in agreement." },
                { c: "Export", q: "What do I get at the end?", a: "A 1080p MP4 (H.264) or WebM (VP9), in 16:9, 9:16, 1:1, 4:3 or your source aspect. The preview and the exported file are drawn by the same renderer, so what you signed off is what lands in the file." },
                { c: "Export", q: "Will my work survive a reload?", a: "Yes. Media is written to the browser's file system once and edits autosave as JSON, so closing the tab is safe and your last project reopens on its own. You can also delete a project and its media outright." },
                { c: "Support", q: "Which browsers work?", a: "Chrome and Edge are the target today, because the capture and encode paths lean on WebCodecs and the floating camera window uses Document Picture-in-Picture. Other browsers are not supported yet." },
              ].map((f, i) => (
                <details key={i} name="faq" className="faq-item">
                  <summary className="faq-row">
                    <span style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                      <span className="faq-cat">{f.c}</span>
                      <span className="faq-question">{f.q}</span>
                    </span>
                    <span className="faq-chevron">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><polyline points="6 9 12 15 18 9" /></svg>
                    </span>
                  </summary>
                  <p className="faq-answer">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="container" style={{ padding: "24px 40px 48px", textAlign: "center" }}>
          <Link href="/editor" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#1F1F1F", color: "#fff", borderRadius: 100, padding: "12px 28px", fontFamily: "var(--font-poppins)", fontWeight: 500, textDecoration: "none", transition: "background 0.15s" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#0070f3")} onMouseLeave={(e) => (e.currentTarget.style.background = "#1F1F1F")}>Open editor →</Link>
          <p style={{ marginTop: 10, fontFamily: "var(--font-poppins)", fontSize: 12, color: "#888" }}>No API keys · WebCodecs · 100% in browser</p>
        </section>

        <footer style={{ borderTop: "1px solid #ebebeb", padding: "24px 0", background: "#fff" }}>
          <div className="container" style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/favicon-logo.webp" alt="" width={20} height={20} style={{ objectFit: "contain" }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/text-logo-dark.webp" alt="Panoptik" width={110} height={22} style={{ height: 22, width: "auto", objectFit: "contain" }} />
              <span style={{ fontFamily: "var(--font-poppins)", fontSize: 12, color: "#888", border: "1px solid #ebebeb", background: "#F8F8F8", borderRadius: 100, padding: "2px 8px" }}>WebMCP</span>
            </span>
            <span style={{ fontFamily: "var(--font-poppins)", fontSize: 12, color: "#888" }}>Browser-native demo studio · No uploads, no server.</span>
          </div>
        </footer>
      </div>
    </>
  );
}
