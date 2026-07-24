import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata = {
  title: "daily.chebakov.me",
  description:
    "A personal morning dashboard for focused study and daily research.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
