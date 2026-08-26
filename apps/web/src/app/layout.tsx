import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Panoptik — Open Demo Studio × WebMCP",
  description:
    "Browser-native demo video editor where humans and AI agents co-edit on the same canvas via WebMCP. No uploads, no server.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32.webp", sizes: "32x32", type: "image/webp" },
      { url: "/favicon-48.webp", sizes: "48x48", type: "image/webp" },
    ],
    apple: [{ url: "/favicon-180.webp", sizes: "180x180", type: "image/webp" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased" style={{ background: "#fafafa", color: "#171717" }}>{children}</body>
    </html>
  );
}
