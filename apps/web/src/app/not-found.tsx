export default function NotFound() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#08090a] text-gray-400">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-200">404</h1>
        <p className="mt-4 text-lg">Page not found</p>
        <a href="/editor" className="mt-6 inline-block text-indigo-400 hover:text-indigo-300">
          Go to Editor
        </a>
      </div>
    </div>
  );
}
