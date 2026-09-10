import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '@/components/layout/Page';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { useAnalytics, selectPlanVsActualByTracker } from '@/services/analyticsService';
import { useLiveProfile, useLiveSettings } from '@/state/useLiveData';
import { RangeSelector } from './components/AnalyticsPrimitives';
import { useAnalyticsRangeSelector } from './range';
import { OverviewSection } from './sections/OverviewSection';
import { StudySection } from './sections/StudySection';
import { PillarSection } from './sections/PillarSection';
import { TimeSection } from './sections/TimeSection';
import { GoalsSection } from './sections/GoalsSection';
import { PlanningAccuracyPanel } from './sections/PlanningAccuracyPanel';

/**
 * Analytics is a set of separate, focused sections — never one long scroll.
 * Each tab answers a single question and shows only what that question needs.
 * Every figure below comes from the pure AnalyticsEngine via `useAnalytics`;
 * this file computes nothing.
 */

const SECTIONS = [
  { value: 'overview', label: 'Overview' },
  { value: 'study', label: 'Study' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'skills', label: 'Skills' },
  { value: 'personal', label: 'Personal' },
  { value: 'time', label: 'Time' },
  { value: 'goals', label: 'Goals' },
] as const;

export type AnalyticsSectionKey = (typeof SECTIONS)[number]['value'];

function isSection(value: string | undefined): value is AnalyticsSectionKey {
  return SECTIONS.some((s) => s.value === value);
}

const SUBTITLES: Record<AnalyticsSectionKey, string> = {
  overview: 'How the period went overall.',
  study: 'Is the studying working?',
  fitness: 'How much training happened, and how regularly?',
  skills: 'Where did deliberate practice go?',
  personal: 'How much of life outside work got its time?',
  time: 'Where the hours went, and whether reality matched the plan.',
  goals: 'Which goals are advancing, and which have stalled.',
};

export function AnalyticsPage() {
  const params = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const settings = useLiveSettings();
  const profile = useLiveProfile();
  const section: AnalyticsSectionKey = isSection(params.section) ? params.section : 'overview';

  const range = useAnalyticsRangeSelector(settings?.weekStartsOn ?? 1);
  const bundle = useAnalytics(range.from, range.to);

  const planVsActual = useMemo(
    () => (bundle ? selectPlanVsActualByTracker(bundle.input, bundle.result) : []),
    [bundle],
  );

  return (
    <Page
      title="Analytics"
      subtitle={SUBTITLES[section]}
      wide
      toolbar={
        <div className="space-y-4">
          <Tabs
            items={SECTIONS.map((s) => ({ value: s.value, label: s.label }))}
            value={section}
            onChange={(v) => navigate(v === 'overview' ? '/analytics' : `/analytics/${v}`)}
          />
          <RangeSelector range={range} />
        </div>
      }
    >
      {!bundle ? (
        <Card className="flex h-40 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
        </Card>
      ) : (
        <>
          {section === 'overview' && (
            <>
              <OverviewSection overview={bundle.result.overview} goals={bundle.result.goals} profile={profile} />
              <PlanningAccuracyPanel planning={bundle.result.planning} />
            </>
          )}
          {section === 'study' && (
            <>
              <StudySection study={bundle.result.study} />
              <PillarSection metrics={bundle.result.studyPillar} pillar="study" variant="consistency" />
            </>
          )}
          {section === 'fitness' && <PillarSection metrics={bundle.result.fitness} pillar="fitness" />}
          {section === 'skills' && <PillarSection metrics={bundle.result.skills} pillar="skills" />}
          {section === 'personal' && <PillarSection metrics={bundle.result.personal} pillar="personal" />}
          {section === 'time' && (
            <>
              <TimeSection time={bundle.result.time} planVsActual={planVsActual} />
              <PlanningAccuracyPanel planning={bundle.result.planning} />
            </>
          )}
          {section === 'goals' && <GoalsSection goals={bundle.result.goals} />}
        </>
      )}
    </Page>
  );
}
