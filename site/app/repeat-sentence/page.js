import RepeatSentence from "@/components/RepeatSentence";
import Link from "next/link";

export const metadata = {
  title: "Repeat sentence · daily.chebakov.me",
};

export default function RepeatSentencePage() {
  return (
    <div className="page-shell">
      <main className="page-main">
        <header className="site-header">
          <h1 className="site-title">Repeat sentence</h1>
          <p className="site-subtitle">PTE-style listening practice</p>
        </header>
        <RepeatSentence />
        <Link className="back-link" href="/">
          ← back to daily.chebakov.me
        </Link>
      </main>
    </div>
  );
}
