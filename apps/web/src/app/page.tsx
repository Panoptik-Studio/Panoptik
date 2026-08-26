import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Panoptik</h1>
      <p className="max-w-xl text-center text-gray-400">
        The open-source, client-side demo video studio where you and your AI agent
        co-edit on the same canvas. Drop in a recording, review the agent&apos;s staged
        diff, commit, export — all in-browser.
      </p>
      <Link
        href="/editor"
        className="rounded-lg bg-indigo-600 px-6 py-3 font-medium hover:bg-indigo-500"
      >
        Open the editor
      </Link>
    </main>
  );
}
