import { useEffect, useState } from 'react';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/Toaster';
import { ensureSeeded } from '@/db/seed';
import { applyAccent, type AccentId } from '@/lib/accent';
import { applyTheme, getSettings, readCachedTheme, watchSystemTheme } from '@/services/settingsService';
import { runStartupMaintenance } from '@/services/maintenanceService';
import { protectStorageAtBoot } from '@/services/storageGuardService';
import { settleStartedBlocks } from '@/services/scheduleService';
import { startAchievementSync, stopAchievementSync } from '@/services/achievementSync';
import { startAgentBridge, stopAgentBridge } from '@/agent/bridgeClient';
import { installAudioUnlock } from '@/lib/sounds';
import { startNotificationLoop, stopNotificationLoop } from '@/services/notificationService';
import { startNotificationCenter } from '@/services/notificationCenter';
import { useAutoRescheduleStore } from '@/state/autoRescheduleStore';
import { AutoRescheduleReviewDialog } from '@/features/schedule/AutoRescheduleReview';
import { LockedFocusOverlay } from '@/features/focus/LockedFocusOverlay';
import { CompleteBlockSheet } from '@/features/schedule/CompleteBlockSheet';
import { CloseDaySheet } from '@/features/review/CloseDaySheet';
import { ExamPlannerSheet } from '@/features/practice/ExamPlannerSheet';

import { HomePage } from '@/features/home/HomePage';
import { SchedulePage } from '@/features/schedule/SchedulePage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { GoalsPage } from '@/features/goals/GoalsPage';
import { ChecklistsPage } from '@/features/checklists/ChecklistsPage';
import { ProjectDetailPage, ProjectsPage } from '@/features/projects/ProjectsPage';
import { ClickUpPage } from '@/features/clickup/ClickUpPage';
import { startClickUpSync } from '@/integrations/clickup/linkService';
import { EarningPage } from '@/features/earning/EarningPage';
import { ExamsPage } from '@/features/exams/ExamsPage';
import { ResearchPage, SkillsPage } from '@/features/research/ResearchPage';
import { GoalDetailPage } from '@/features/goals/GoalDetailPage';
import { FocusPage } from '@/features/focus/FocusPage';
import { PaperRunnerPage } from '@/features/focus/PaperRunnerPage';
import { PaperReviewPage } from '@/features/focus/PaperReviewPage';
import { RevisionPage } from '@/features/revision/RevisionPage';
import { TrackersPage } from '@/features/trackers/TrackersPage';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { AchievementsPage } from '@/features/achievements/AchievementsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { PracticePage } from '@/features/practice/PracticePage';
import { FileViewerPage } from '@/features/practice/FileViewerPage';
import { DailyReviewPage } from '@/features/review/DailyReviewPage';
import { WeeklyReviewPage } from '@/features/review/WeeklyReviewPage';
import { RuleBuilderPage } from '@/features/planning/RuleBuilderPage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => setSlow(true), 15_000);
    return () => window.clearTimeout(t);
  }, [ready]);

  const runStartupCheck = useAutoRescheduleStore((s) => s.runStartupCheck);

  useEffect(() => {
    let cancelled = false;
    // The pre-paint script in index.html has already applied the stored theme
    // (defaulting to dark). Do not re-apply here — readCachedTheme() defaults
    // to `system`, which would flash light on a light-mode OS. The DB value is
    // applied below once it is actually known.

    (async () => {
      try {
        await ensureSeeded();
        void protectStorageAtBoot();
        // A block started earlier (e.g. School) is logged once its time ends.
        await settleStartedBlocks();
        const settings = await getSettings();
        applyTheme(settings.theme);
        applyAccent(settings.appearance?.accent as AccentId | undefined);
        // Materialise recurring rules / mark missed revisions / roll snapshots.
        await runStartupMaintenance();
        if (!cancelled) setReady(true);
        // Auto-reschedule: off/suggest/automatic per settings — see SPEC §40,
        // nothing here may move a task without eventually telling the user.
        void runStartupCheck();
        // Local reminders. No permission is requested here — the loop is a
        // silent no-op until the user opts in from Settings.
        startNotificationLoop();
        // In-app Notification Center: real activity + time-based reminders.
        startNotificationCenter();
        // Achievements unlock from real records, whichever page is open.
        startAchievementSync();
        // External AI agents (opt-in, Settings → Agents).
        startAgentBridge();
        // Linked ClickUp tasks reconcile every few minutes (no-op when none are linked).
        startClickUpSync();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    const unwatch = watchSystemTheme(() => readCachedTheme());
    const unlockAudio = installAudioUnlock();
    const settle = window.setInterval(() => { void settleStartedBlocks(); }, 60_000);
    return () => { cancelled = true; unwatch(); unlockAudio(); stopNotificationLoop(); stopAchievementSync(); stopAgentBridge(); window.clearInterval(settle); };
  }, [runStartupCheck]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-base p-6">
        <div className="w-full max-w-md rounded-panel border border-critical/30 bg-surface-raised p-6 shadow-panel">
          <h1 className="t-title text-critical">LifeOS could not start</h1>
          <p className="t-muted mt-2">{error}</p>
          <p className="t-meta mt-3">
            Your data lives in JSON files (and a local cache of them). Nothing has been overwritten.
            If this persists, open Settings → Storage to see which file failed, or import a{' '}
            <code>lifeos.json</code> bundle to restore.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <LoadingScreen>
        {slow ? (
          <div className="max-w-sm px-6 text-center">
            <p className="t-muted">
              The browser storage is slow to respond. Your data is not deleted — close LifeOS completely and open it again.
            </p>
            <button
              type="button"
              className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        ) : null}
      </LoadingScreen>
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
          <Route path="checklists" element={<ChecklistsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="earning" element={<EarningPage />} />
          <Route path="clickup" element={<ClickUpPage />} />
          <Route path="exams" element={<ExamsPage />} />
          <Route path="research" element={<ResearchPage />} />
          <Route path="skills" element={<SkillsPage />} />
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
          <Route path="practice" element={<PracticePage />} />
          <Route path="practice/resource/:resourceId" element={<FileViewerPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="planning/rules" element={<RuleBuilderPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
      <AutoRescheduleReviewDialog />
      <LockedFocusOverlay />
      <CompleteBlockSheet />
      <CloseDaySheet />
      <ExamPlannerSheet />
    </>
  );
}
