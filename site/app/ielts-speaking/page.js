import IeltsSpeaking from "@/components/IeltsSpeaking";
import Link from "next/link";

export const metadata = {
  title: "IELTS speaking · sandbox.chebakov.me",
  description:
    "All three IELTS speaking parts with audio-aware band-7.5 feedback.",
};

export default function IeltsSpeakingPage() {
  return (
    <div className="page-shell ielts-page-shell">
      <main className="page-main ielts-main">
        <header className="site-header">
          <h1 className="site-title">IELTS speaking</h1>
          <p className="site-subtitle">
            Parts 1, 2 &amp; 3 · audio-aware feedback · target band 7.5
          </p>
        </header>
        <IeltsSpeaking />
        <Link className="back-link" href="https://daily.chebakov.me/">
          ← back to daily.chebakov.me
        </Link>
      </main>
    </div>
  );
}
