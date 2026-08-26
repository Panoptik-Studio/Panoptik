import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Panoptik — Open Demo Studio × WebMCP",
  description:
    "Browser-native demo video editor where humans and AI agents co-edit on the same canvas via WebMCP. No uploads, no server.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  );
}
