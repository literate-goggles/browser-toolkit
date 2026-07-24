import DailyDashboard from "@/components/DailyDashboard";

export const metadata = {
  title: "Morning brief · daily.chebakov.me",
  description:
    "A personal daily dashboard for IELTS, machine learning research, history, cars, and Russian poetry.",
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
