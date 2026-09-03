import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Panoptik — AI Video Studio × WebMCP",
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Caveat:wght@600;700&family=Fira+Code:wght@500;700&family=Inter:wght@400;500;600;700;800;900&family=Montserrat:wght@500;700;800;900&family=Oswald:wght@500;600;700&family=Outfit:wght@500;600;700;800;900&family=Playfair+Display:ital,wght@0,600;0,700;0,900;1,600;1,700&family=Poppins:wght@500;600;700;800;900&family=Roboto:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased" style={{ background: "#f8f8f8", color: "#1a1a1a" }}>{children}</body>
    </html>
  );
}
