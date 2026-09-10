import { useState } from 'react';
import { Page } from '@/components/layout/Page';
import { Tabs } from '@/components/ui/Tabs';
import { useLiveSettings, useTrackers } from '@/state/useLiveData';
import { useAnalyticsRangeSelector } from '@/features/analytics/range';
import { TrackerManagement } from './TrackerManagement';
import { TrackerPillarPage } from './TrackerPillarPage';
import type { Pillar } from '@/types';

type TrackerTab = 'all' | Exclude<Pillar, 'system'>;

const TABS: { value: TrackerTab; label: string }[] = [
  { value: 'all', label: 'All trackers' },
  { value: 'study', label: 'Study' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'skills', label: 'Skills' },
  { value: 'personal', label: 'Personal' },
];

const SUBTITLES: Record<TrackerTab, string> = {
  all: 'Pillars and the subjects beneath them. Every task, block, session and activity belongs to exactly one tracker.',
  study: 'Study time, questions and subject performance, plus the subjects time is attributed to.',
  fitness: 'Sessions, duration and consistency, plus the activities time is attributed to.',
  skills: 'Practice hours, projects and courses, plus the skills time is attributed to.',
  personal: 'Habits, reading and hobbies, plus the areas time is attributed to.',
};

/**
 * Trackers is both the management surface and each pillar's own dashboard. The
 * pillar tabs reuse the shared analytics engine through `TrackerPillarPage` —
 * one universal implementation, parameterised by pillar.
 */
export function TrackersPage() {
  const trackers = useTrackers(true);
  const settings = useLiveSettings();
  const [tab, setTab] = useState<TrackerTab>('all');
  const [showArchived, setShowArchived] = useState(false);
  const range = useAnalyticsRangeSelector(settings?.weekStartsOn ?? 1);

  return (
    <Page
      title="Trackers"
      subtitle={SUBTITLES[tab]}
      wide
      toolbar={<Tabs items={TABS.map((t) => ({ value: t.value, label: t.label }))} value={tab} onChange={setTab} />}
    >
      {tab === 'all' ? (
        <TrackerManagement
          trackers={trackers}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((v) => !v)}
        />
      ) : (
        <TrackerPillarPage
          pillar={tab}
          trackers={trackers}
          range={range}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((v) => !v)}
        />
      )}
    </Page>
  );
}
