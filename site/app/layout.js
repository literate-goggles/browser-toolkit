import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata = {
  title: "daily.chebakov.me",
  description:
    "A personal morning dashboard for focused study and daily research.",
  icons: {
    icon: [
      {
        url: "/favicon.svg?v=20260913",
        type: "image/svg+xml",
      },
      {
        url: "/favicon.ico?v=20260913",
        sizes: "16x16 32x32 48x48",
      },
    ],
    shortcut: "/favicon.ico?v=20260913",
    apple: "/apple-touch-icon.png?v=20260913",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
