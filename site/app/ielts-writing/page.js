import IeltsWriting from "@/components/IeltsWriting";
import Link from "next/link";

export const metadata = {
  title: "IELTS writing · daily.chebakov.me",
  description:
    "Timed IELTS Academic writing practice with band-7.5-focused feedback.",
};

export default function IeltsWritingPage() {
  return (
    <div className="page-shell ielts-page-shell">
      <main className="page-main ielts-main writing-main">
        <header className="site-header">
          <h1 className="site-title">IELTS writing</h1>
          <p className="site-subtitle">
            Academic Task 1 &amp; 2 · target band 7.5
          </p>
        </header>
        <IeltsWriting />
        <Link className="back-link" href="/">
          ← back to daily.chebakov.me
        </Link>
      </main>
    </div>
  );
}
