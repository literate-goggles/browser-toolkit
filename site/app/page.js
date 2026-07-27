import DailyDashboard from "@/components/DailyDashboard";

export const metadata = {
  title: "Morning Brief · daily.chebakov.me",
  description:
    "A personal daily dashboard for IELTS, chess, mathematics, machine learning research, history, cars, and Russian poetry.",
};

export default function HomePage() {
  return (
    <div className="page-shell daily-page-shell">
      <main className="page-main daily-main">
        <DailyDashboard />
      </main>
    </div>
  );
}
