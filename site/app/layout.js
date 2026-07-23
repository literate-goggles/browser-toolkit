import "./globals.css";

export const metadata = {
  title: "daily.chebakov.me",
  description:
    "Personal study tools for vocabulary, listening and IELTS speaking.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
