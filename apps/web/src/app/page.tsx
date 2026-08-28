"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// Gift4Day tokens adapted for Panoptik — no images from reference, just fonts/padding/tokens
export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [leftPos, setLeftPos] = useState({ x: 0, y: 0 });
  const [rightPos, setRightPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
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
              <ul style={{ display: "flex", alignItems: "center", gap: 80, listStyle: "none", margin: 0, padding: 0 }}>
                {[
                  { label: "How it works", href: "#how" },
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
                Plan, record &amp; co-edit with your AI agent. Screen + camera, zoom-to-point, captions and export — all in your browser, no upload.
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
                  <strong style={{ fontFamily: "var(--font-poppins)", fontSize: 14, fontWeight: 500, color: "#111" }}>Captions staged</strong>
                  <span style={{ fontFamily: "var(--font-poppins)", fontSize: 12, color: "#888" }}>12 segments · commit to burn in</span>
                </span>
              </div>
            </div>

            {/* Laptop mock — larger, no floating cards */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginTop: "clamp(-20px, -2vw, -10px)", marginBottom: "clamp(-20px, -2vw, -10px)" }}>
              <div style={{ width: "clamp(380px, 78vw, 1080px)", aspectRatio: "16/9.8", borderRadius: 16, background: "#111", border: "6px solid #fff", boxShadow: "0 24px 64px rgba(0,0,0,0.18)", overflow: "hidden", position: "relative", zIndex: 2 }}>
                <div style={{ height: 28, background: "#1a1c21", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 6, padding: "0 10px" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: "#ef4444" }} /><span style={{ width: 8, height: 8, borderRadius: 999, background: "#f59e0b" }} /><span style={{ width: 8, height: 8, borderRadius: 999, background: "#10b981" }} />
                  <span style={{ marginLeft: 8, fontFamily: "var(--font-poppins)", fontSize: 10, color: "#888" }}>panoptik — preview equals export</span>
                </div>
                <div style={{ height: "calc(100% - 28px)", background: "linear-gradient(180deg, #0f1012 0%, #070709 100%)", display: "flex", alignItems: "stretch", gap: 12, padding: 16, position: "relative" }}>
                  {/* WebMCP card */}
                  <div style={{ flex: 1, background: "#fff", borderRadius: 12, border: "1px solid #ebebeb", padding: 16, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 28, height: 28, borderRadius: 8, background: "#0070f3", color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-poppins)", fontWeight: 700, fontSize: 12 }}>W</span>
                      <span style={{ fontFamily: "var(--font-poppins)", fontWeight: 600, fontSize: 13, color: "#1A1A1A" }}>WebMCP</span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-lato)", fontStyle: "italic", fontWeight: 800, fontSize: 10, color: "#0070f3", background: "#d3e5ff", borderRadius: 100, padding: "2px 8px" }}>Protocol</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-nunito)", fontSize: 12, lineHeight: "140%", color: "#424242" }}>
                      <li>Model Context Protocol for the web — structured <strong>tools</strong>, not screenshots.</li>
                      <li>Agent sees canvas + calls <code style={{ background: "#f1f1f1", borderRadius: 4, padding: "1px 6px", fontFamily: "monospace", fontSize: 11 }}>propose_zoom_points</code>, <code style={{ background: "#f1f1f1", borderRadius: 4, padding: "1px 6px", fontFamily: "monospace", fontSize: 11 }}>generate_captions</code> etc.</li>
                      <li>Human stays in control — staged diff → commit.</li>
                      <li>100% local, no DOM scraping.</li>
                    </ul>
                  </div>
                  {/* Panoptik card */}
                  <div style={{ flex: 1, background: "#fff", borderRadius: 12, border: "1px solid #ebebeb", padding: 16, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 28, height: 28, borderRadius: 8, background: "#1F1F1F", color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-lato)", fontWeight: 800, fontSize: 12 }}>P</span>
                      <span style={{ fontFamily: "var(--font-poppins)", fontWeight: 600, fontSize: 13, color: "#1A1A1A" }}>Panoptik</span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-lato)", fontStyle: "italic", fontWeight: 800, fontSize: 10, color: "#1A1A1A", background: "#f1f1f1", borderRadius: 100, padding: "2px 8px" }}>Studio</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-nunito)", fontSize: 12, lineHeight: "140%", color: "#424242" }}>
                      <li>Browser-native demo studio — record screen + camera, no upload.</li>
                      <li>Timeline diamonds, staged ghosts, commit, export — preview equals export.</li>
                      <li>Captions via Whisper in worker, backgrounds, facecam PiP.</li>
                      <li>Open, local, fast — your video, your control.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works — Gift4Day arrow pattern + detailed cards */}
        <section id="how" style={{ background: "#F8F8F8", padding: "80px 0" }}>
          <div className="container" style={{ paddingTop: 8, paddingBottom: 8 }}>
            <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14, marginBottom: 40, padding: "0 12px" }}>
              <span style={{ fontFamily: "var(--font-poppins)", fontSize: 12, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#0070f3" }}>— How it works —</span>
              <h2 style={{ fontFamily: "var(--font-lato)", fontWeight: 800, fontSize: "clamp(26px, 4.6vw, 60px)", lineHeight: "120%", color: "#1A1A1A" }}>How It <em style={{ fontFamily: "var(--font-alkatra)", fontWeight: 700, fontStyle: "normal" }}>Works</em>?</h2>
              <p style={{ fontFamily: "var(--font-poppins)", fontWeight: 300, fontSize: 16, color: "#424242", lineHeight: "160%", maxWidth: 560, margin: "0 auto" }}>
                Record or import, let your agent propose, review the staged diff on your timeline, commit, and export — preview equals export, every pixel.
              </p>
            </div>

            {/* Arrows + cards — no side cut */}
            <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "flex-start", gap: 20, overflowX: "auto", padding: "16px 32px 24px", maxWidth: "fit-content", margin: "0 auto" }} className="how-grid">
              <style>{`
                .how-grid { scrollbar-width: none; scroll-snap-type: x proximity; }
                .how-grid::-webkit-scrollbar { display: none; }
                .how-arrow { width: 60px; height: 80px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin-top: 56px; opacity: 0.9; }
                @media (max-width: 1100px) { .how-grid { flex-wrap: wrap; gap: 20px; justify-content: center; padding: 12px 24px; max-width: 100%; } .how-arrow { display: none !important; } }
                @media (max-width: 768px) { .how-grid { flex-direction: column; align-items: center; gap: 20px; padding: 12px 16px; } .how-arrow { display: none !important; } }
              `}</style>
              {[
                { n: "01", t: "Record or import", d: "Capture screen + webcam + mic — pick layout (screen / screen+camera / camera) and shape (circle/square), use 3-2-1 countdown and teleprompter, or simply drop MP4/WebM/MOV. All local, no upload.", c: "#1F1F1F", tags: ["Screen", "Webcam", "Mic", "Teleprompter"] },
                { n: "02", t: "Co-edit with agent", d: "In ChatGPT the agent sees your canvas and calls WebMCP tools: propose_zoom_points, generate_captions (Whisper), set_background, add_text_overlay. Every proposal lands as a dashed amber ghost on your timeline — staged, never auto-committed. Review, drag to retime, hover × to discard, check ToolTrace.", c: "#0070f3", tags: ["WebMCP", "Staged", "Timeline", "Ghosts"] },
                { n: "03", t: "Commit & export", d: "Open the staged diff, approve → ghosts become solid, history pushes, undo/redo across all kinds. The same renderFrame draws preview and 1080p MP4/WebM: background → clamped zoom → facecam PiP (circle/square) → text → captions. Download locally.", c: "#10b981", tags: ["Diff", "History", "MP4", "WebM"] },
              ].map((c, idx) => (
                <div key={c.n} style={{ display: "contents" }}>
                  <div style={{ flex: "1 1 300px", maxWidth: 360, minWidth: 280, background: "#fff", border: "1px solid #ebebeb", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0, minHeight: 240, boxShadow: "0 2px 12px rgba(0,0,0,0.04)", scrollSnapAlign: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 36, height: 36, borderRadius: 100, background: c.c, color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-poppins)", fontWeight: 700, fontSize: 13 }}>{c.n}</span>
                      <span style={{ fontFamily: "var(--font-poppins)", fontWeight: 600, fontSize: 16, color: "#1A1A1A" }}>{c.t}</span>
                    </div>
                    <p style={{ fontFamily: "var(--font-nunito)", fontSize: 13.5, lineHeight: "160%", color: "#555", margin: 0 }}>{c.d}</p>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto", paddingTop: 4 }}>
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

            <div style={{ marginTop: 24, background: "#fff", border: "1px solid #ebebeb", borderRadius: 16, padding: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", maxWidth: 1100, marginLeft: "auto", marginRight: "auto" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-poppins)", fontSize: 12, color: "#1A1A1A" }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: "#1F1F1F", color: "#fff", display: "grid", placeItems: "center", fontSize: 12 }}>▶</span>
                <span><strong>Tip:</strong> <code style={{ background: "#f1f1f1", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace", fontSize: 11 }}>Space</code> play/pause · <code style={{ background: "#f1f1f1", borderRadius: 4, padding: "2px 6px", fontFamily: "monospace", fontSize: 11 }}>M</code> mark</span>
              </span>
              <Link href="/editor" style={{ background: "#1F1F1F", color: "#fff", borderRadius: 100, padding: "10px 18px", fontFamily: "var(--font-poppins)", fontWeight: 500, fontSize: 13, textDecoration: "none" }}>Try in editor →</Link>
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
              .faq-row { display: flex; justify-content: space-between; align-items: center; padding: 32px 40px; cursor: pointer; list-style: none; user-select: none; gap: 16px; }
              .faq-row::-webkit-details-marker { display: none; }
              .faq-question { font-family: var(--font-poppins); font-weight: 600; font-size: 28px; line-height: 1.2; color: #1A1A1A; }
              .faq-chevron { width: 24px; height: 24px; flex-shrink: 0; color: #888; display: flex; align-items: center; justify-content: center; transition: transform 0.3s, color 0.3s; }
              .faq-chevron svg { width: 20px; height: 20px; }
              .faq-item[open] .faq-chevron { transform: rotate(180deg); color: #1A1A1A; }
              .faq-answer { padding: 0 40px 28px; font-family: var(--font-poppins); font-size: 18px; line-height: 150%; color: #424242; animation: faq-fade-in 0.4s cubic-bezier(0.4,0,0.2,1); }
              @keyframes faq-fade-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
              @media (max-width: 900px) { .faq-inner { padding: 0 24px; } .faq-title { font-size: 44px; } .faq-row { padding: 24px; } }
              @media (max-width: 768px) { .faq-inner { padding: 0 16px; } .faq-title { font-size: 33px; } .faq-question { font-size: 20px; } .faq-answer { padding: 0 16px 16px; } }
            `}</style>
            <div className="faq-header">
              <h2 className="faq-title"><em>FAQs</em>?</h2>
              <p className="faq-subtitle">Everything you need to know before you hit record.</p>
            </div>
            <div className="faq-list">
              {[
                { q: "What is Panoptik?", a: "A browser-native demo studio. Record screen + camera, co-edit on the same canvas with your AI agent via WebMCP, and export MP4/WebM — preview equals export." },
                { q: "What is WebMCP?", a: "Model Context Protocol for the web. Instead of screenshots, the agent sees your canvas and calls structured tools — propose_zoom_points, generate_captions, set_background — staged as ghosts you approve." },
                { q: "Is anything uploaded?", a: "No. Captions run locally via Whisper in a worker (Xenova), video decodes via WebCodecs, all in your browser. No API keys, no server." },
                { q: "How do zoom points work?", a: "Click the preview while paused to add a zoom at the playhead (or let the agent propose). Drag the focal to reposition, drag diamonds on the timeline to retime. Hold is automatic until the next point." },
              ].map((f, i) => (
                <details key={i} className="faq-item">
                  <summary className="faq-row">
                    <span className="faq-question">{f.q}</span>
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
          <p style={{ marginTop: 10, fontFamily: "var(--font-poppins)", fontSize: 12, color: "#888" }}>No API keys · WebCodecs + Whisper in a worker · 100% in browser</p>
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
