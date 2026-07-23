import "./globals.css";

export const metadata = {
  title: "daily.chebakov.me",
  description:
    "Personal study tools for vocabulary, listening, IELTS speaking and writing.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
