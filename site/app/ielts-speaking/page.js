import IeltsSpeaking from "@/components/IeltsSpeaking";
import Link from "next/link";

export const metadata = {
  title: "IELTS speaking · daily.chebakov.me",
  description:
    "Timed IELTS speaking practice with transcription and band-focused feedback.",
};

export default function IeltsSpeakingPage() {
  return (
    <div className="page-shell ielts-page-shell">
      <main className="page-main ielts-main">
        <header className="site-header">
          <h1 className="site-title">IELTS speaking</h1>
          <p className="site-subtitle">Timed practice · target band 7.5</p>
        </header>
        <IeltsSpeaking />
        <Link className="back-link" href="/">
          ← back to daily.chebakov.me
        </Link>
      </main>
    </div>
  );
}
