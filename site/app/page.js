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
              sentences and a whole-list study session. Multiple sources
              (books, CEFR lists, exam banks).
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
