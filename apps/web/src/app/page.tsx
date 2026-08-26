"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#fafafa] text-[#171717]" style={{ fontFamily: "var(--font-sans)" }}>
      {/* Nav — 64px like editor */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-white px-6" style={{ borderColor: "#ebebeb" }}>
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon-logo.webp" alt="" width={28} height={28} className="h-7 w-7 object-contain" draggable={false} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/text-logo-dark.webp" alt="Panoptik" width={96} height={22} className="hidden h-[22px] w-auto object-contain sm:block" draggable={false} />
          <span className="hidden sm:inline-flex rounded-full px-2 py-0.5 font-mono text-[11px]" style={{ background: "#fafafa", color: "#666", border: "1px solid #ebebeb" }}>Local · No upload</span>
        </div>
        <div className="flex items-center gap-2">
          <a href="https://github.com/Panoptik-Studio/Panoptik" target="_blank" className="hidden sm:inline-flex rounded-full border bg-white px-3 py-1.5 text-xs font-medium transition-colors" style={{ borderColor: "#ebebeb", color: "#171717" }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}>
            GitHub
          </a>
          <Link href="/editor" className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium text-white transition-colors" style={{ background: "#171717" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "#171717"; }}>
            Open editor →
          </Link>
        </div>
      </header>

      {/* Hero — mesh gradient behind, Vercel hero-band */}
      <section className="relative overflow-hidden border-b bg-white" style={{ borderColor: "#ebebeb" }}>
        <div className="pointer-events-none absolute inset-0 opacity-[0.09]" style={{ background: "radial-gradient(800px 420px at 18% 18%, #007cf0 0%, transparent 60%), radial-gradient(700px 500px at 82% 20%, #7928ca 0%, transparent 62%), radial-gradient(640px 420px at 78% 88%, #ff4d4d 0%, transparent 60%), radial-gradient(520px 340px at 12% 90%, #50e3c2 0%, transparent 62%)" }} />
        <div className="relative mx-auto max-w-[1100px] px-6 py-16 sm:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs" style={{ borderColor: "#ebebeb", color: "#666" }}>
            <span className="h-2 w-2 rounded-full bg-[#0070f3] animate-pulse" /> WebMCP Challenge · No server · 100% in browser
          </div>
          <h1 className="mt-6 max-w-[18ch] text-[40px] font-semibold leading-[42px] tracking-[-1.8px] sm:text-[48px] sm:leading-[48px] sm:tracking-[-2.4px]" style={{ color: "#171717" }}>
            Record. Co-edit with your agent. Export.
          </h1>
          <p className="mt-4 max-w-[48ch] text-[16px] leading-6" style={{ color: "#4d4d4d" }}>
            The open demo studio where you and ChatGPT co-edit on the same canvas via <span className="font-mono text-[13px] text-[#0070f3]">WebMCP</span>. Drop a recording, let the agent propose zooms, captions and backgrounds, review the staged diff, commit, export — all in your browser.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/editor" className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-colors" style={{ background: "#171717" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "#171717"; }}>
              Open editor <span aria-hidden>→</span>
            </Link>
            <a href="#features" className="inline-flex items-center rounded-full border bg-white px-5 py-2.5 text-sm font-medium transition-colors" style={{ borderColor: "#ebebeb", color: "#171717" }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}>
              How it works
            </a>
          </div>
          <p className="mt-3 font-mono text-[11px] tracking-wide" style={{ color: "#888" }}>No upload · No API keys · WebCodecs + Whisper in WebAssembly</p>

          {/* Preview mock — ex-card-marketing-large */}
          <div className="mt-10 overflow-hidden rounded-xl border bg-white" style={{ borderColor: "#ebebeb", boxShadow: "0 0 0 1px rgba(0,0,0,0.06) inset, 0 8px 24px rgba(0,0,0,0.06)" }}>
            <div className="flex h-7 items-center gap-1.5 border-b bg-[#fafafa] px-3" style={{ borderColor: "#ebebeb" }}>
              <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" /><span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" /><span className="h-2.5 w-2.5 rounded-full bg-[#10b981]" />
              <span className="ml-2 font-mono text-[10px] tracking-wide" style={{ color: "#888" }}>panoptik — preview equals export</span>
              <span className="ml-auto hidden sm:inline-flex rounded-full bg-[#d3e5ff] px-2 py-0.5 font-mono text-[10px]" style={{ color: "#0070f3" }}>Local preview</span>
            </div>
            <div className="grid gap-6 p-6 sm:grid-cols-[1.35fr_0.85fr]">
              <div className="aspect-[16/9] overflow-hidden rounded-lg border bg-black" style={{ borderColor: "#ebebeb" }}>
                <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a] text-white">
                  <span className="font-mono text-xs tracking-widest opacity-60">Drop a video → timeline diamonds → commit</span>
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-lg border bg-[#fafafa] p-4" style={{ borderColor: "#ebebeb" }}>
                  <p className="font-mono text-[10px] tracking-widest" style={{ color: "#0070f3" }}>STAGED DIFF</p>
                  <ul className="mt-2 space-y-1 font-mono text-xs" style={{ color: "#171717" }}>
                    <li>+ Zoom at 3.2s</li><li>+ Zoom at 7.8s</li><li>+ 12 captions</li><li>+ Background gradient</li>
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <span className="rounded-full bg-[#171717] px-3 py-1 text-xs font-medium text-white">Commit</span>
                    <span className="rounded-full border bg-white px-3 py-1 text-xs" style={{ borderColor: "#ebebeb" }}>Discard</span>
                  </div>
                </div>
                <div className="rounded-lg border bg-white p-3" style={{ borderColor: "#ebebeb" }}>
                  <p className="font-mono text-[10px] tracking-widest" style={{ color: "#888" }}>AGENT TOOL TRACE</p>
                  <p className="mt-1 font-mono text-[11px]" style={{ color: "#0070f3" }}>propose_zoom_points → 2 staged</p>
                  <p className="font-mono text-[11px]" style={{ color: "#0070f3" }}>generate_captions → 12 staged</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features — 3-up cards */}
      <section id="features" className="mx-auto max-w-[1100px] px-6 py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { k: "Record", d: "Screen + webcam + mic in one click. 3-2-1 count, PiP circle/square, layout switch, teleprompter — all local." },
            { k: "Co-edit", d: "Agent proposes via propose_zoom_points, add_text_overlay, set_background, generate_captions — you review ghosts, commit." },
            { k: "Export", d: "Same renderFrame for preview & export. Background, zoom, facecam PiP, text, captions — MP4/WebM in browser." },
          ].map((f) => (
            <div key={f.k} className="rounded-xl border bg-white p-6" style={{ borderColor: "#ebebeb", boxShadow: "0 0 0 1px rgba(0,0,0,0.04) inset, 0 2px 8px rgba(0,0,0,0.04)" }}>
              <h3 className="text-[16px] font-semibold tracking-[-0.02em]" style={{ color: "#171717" }}>{f.k}</h3>
              <p className="mt-2 text-sm leading-6" style={{ color: "#4d4d4d" }}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band — dark polarity */}
      <section className="border-y bg-[#171717] py-10 text-white" style={{ borderColor: "#2a2a2a" }}>
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <p className="text-center font-mono text-xs tracking-wide text-white/60 sm:text-left">Works offline after load · Vercel mesh is the only decoration · Geist · pill 100px · hairline #ebebeb</p>
          <Link href="/editor" className="inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#171717] transition-colors hover:bg-[#d3e5ff]" style={{ color: "#171717" }}>
            Open editor →
          </Link>
        </div>
      </section>

      {/* Footer — 4-col like vercel */}
      <footer className="border-t bg-white px-6 py-8" style={{ borderColor: "#ebebeb" }}>
        <div className="mx-auto max-w-[1100px] flex flex-col gap-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/favicon-logo.webp" alt="" width={20} height={20} className="h-5 w-5 object-contain" />
            <span className="text-sm font-semibold tracking-tight" style={{ color: "#171717" }}>Panoptik</span>
            <span className="rounded-full bg-[#fafafa] px-2 py-0.5 font-mono text-[10px]" style={{ color: "#888", border: "1px solid #ebebeb" }}>WebMCP</span>
          </div>
          <p className="max-w-[42ch] text-xs leading-5" style={{ color: "#888" }}>Browser-native demo editor. No uploads, no server. Whisper via <span className="font-mono">@xenova/transformers</span> in a worker (CDN), canvas via WebCodecs. Shape persists to export.</p>
        </div>
      </footer>
    </div>
  );
}
