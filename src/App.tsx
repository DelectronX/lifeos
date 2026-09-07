import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/Toaster';
import { ensureSeeded } from '@/db/seed';
import { applyTheme, getSettings, readCachedTheme, watchSystemTheme } from '@/services/settingsService';
import { runStartupMaintenance } from '@/services/maintenanceService';

import { HomePage } from '@/features/home/HomePage';
import { SchedulePage } from '@/features/schedule/SchedulePage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { GoalsPage } from '@/features/goals/GoalsPage';
import { GoalDetailPage } from '@/features/goals/GoalDetailPage';
import { FocusPage } from '@/features/focus/FocusPage';
import { PaperRunnerPage } from '@/features/focus/PaperRunnerPage';
import { PaperReviewPage } from '@/features/focus/PaperReviewPage';
import { RevisionPage } from '@/features/revision/RevisionPage';
import { TrackersPage } from '@/features/trackers/TrackersPage';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { AchievementsPage } from '@/features/achievements/AchievementsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { DailyReviewPage } from '@/features/review/DailyReviewPage';
import { WeeklyReviewPage } from '@/features/review/WeeklyReviewPage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    applyTheme(readCachedTheme());

    (async () => {
      try {
        await ensureSeeded();
        const settings = await getSettings();
        applyTheme(settings.theme);
        // Materialise recurring rules / mark missed revisions / roll snapshots.
        await runStartupMaintenance();
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    const unwatch = watchSystemTheme(() => readCachedTheme());
    return () => { cancelled = true; unwatch(); };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-card border border-critical/30 bg-critical/5 p-5">
          <h1 className="t-title text-critical">LifeOS could not start</h1>
          <p className="t-muted mt-2">{error}</p>
          <p className="t-meta mt-3">
            Your data is stored in this browser&apos;s IndexedDB. If this persists, export a backup from
            another browser profile or clear site data to reinitialise.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-r-transparent" />
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="goals/:goalId" element={<GoalDetailPage />} />
          <Route path="focus" element={<FocusPage />} />
          <Route path="focus/paper/:paperId" element={<PaperRunnerPage />} />
          <Route path="focus/paper/:paperId/review" element={<PaperReviewPage />} />
          <Route path="revision" element={<RevisionPage />} />
          <Route path="trackers" element={<TrackersPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="analytics/:section" element={<AnalyticsPage />} />
          <Route path="achievements" element={<AchievementsPage />} />
          <Route path="review/daily" element={<DailyReviewPage />} />
          <Route path="review/weekly" element={<WeeklyReviewPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
