import Link from "next/link";

export default function HomePage() {
  return (
    <div className="page-shell">
      <main className="page-main">
        <header className="site-header">
          <h1 className="site-title">daily.chebakov.me</h1>
          <p className="site-subtitle">Small tools for the everyday</p>
        </header>

        <div className="tool-grid">
          <Link className="tool-card" href="/vocab/">
            <span className="tool-title">English vocab quiz</span>
            <span className="tool-description">
              English → Russian flashcard quizzes with pronunciation, sample
              sentences and a whole-list study session. Multiple sources (books,
              CEFR lists, exam banks).
            </span>
          </Link>
          <Link className="tool-card" href="/repeat-sentence/">
            <span className="tool-title">Repeat sentence</span>
            <span className="tool-description">
              PTE-style listening practice — an audio plays once, you try to
              repeat it back, then reveal the text to check.
            </span>
          </Link>
          <Link className="tool-card" href="/ielts-speaking/">
            <span className="tool-title">IELTS speaking</span>
            <span className="tool-description">
              Timed 25-second and two-minute speaking exercises with fresh
              topics, voice recording, transcription and feedback aimed at band
              7.5.
            </span>
          </Link>
          <Link className="tool-card" href="/ielts-writing/">
            <span className="tool-title">IELTS writing</span>
            <span className="tool-description">
              Timed Academic Task 1 and Task 2 practice with generated
              questions, live word counting and feedback aimed at band 7.5.
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
