import "./globals.css";

export const metadata = {
  title: "daily.chebakov.me",
  description: "Personal study tools — English vocab quizzes and more.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
