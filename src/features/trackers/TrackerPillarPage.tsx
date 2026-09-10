import { Card } from '@/components/ui/Card';
import { useAnalytics } from '@/services/analyticsService';
import { PILLAR_COPY } from '@/features/analytics/pillarCopy';
import { PillarSection } from '@/features/analytics/sections/PillarSection';
import { StudySection } from '@/features/analytics/sections/StudySection';
import { RangeSelector } from '@/features/analytics/components/AnalyticsPrimitives';
import type { RangeController } from '@/features/analytics/range';
import type { Pillar, Tracker } from '@/types';
import { TrackerManagement } from './TrackerManagement';

/**
 * The universal tracker pillar page.
 *
 * Study, Fitness, Skills and Personal all render THIS component — the analysis
 * is identical because it comes from the same `computePillarMetrics` call, only
 * parameterised by pillar. Study additionally gets the study-specific block
 * (questions, accuracy, papers, revision), which is the one genuinely different
 * dataset among the four.
 */
export function TrackerPillarPage({
  pillar, trackers, range, showArchived, onToggleArchived,
}: {
  pillar: Exclude<Pillar, 'system'>;
  trackers: Tracker[];
  range: RangeController;
  showArchived: boolean;
  onToggleArchived: () => void;
}) {
  const copy = PILLAR_COPY[pillar];
  const bundle = useAnalytics(range.from, range.to);

  const pillarTrackers = trackers.filter((t) => t.pillar === pillar);

  return (
    <>
      <div className="mb-5">
        <RangeSelector range={range} />
      </div>

      {!bundle ? (
        <Card className="mb-8 flex h-32 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
        </Card>
      ) : pillar === 'study' ? (
        <>
          <StudySection study={bundle.result.study} />
          <PillarSection metrics={bundle.result.studyPillar} pillar="study" variant="consistency" />
        </>
      ) : (
        <PillarSection metrics={bundle.result[pillar]} pillar={pillar} />
      )}

      <section className="mt-2 border-t border-line pt-6">
        <div className="mb-3">
          <h2 className="t-title">{copy.title} trackers</h2>
          <p className="t-muted mt-0.5">
            Everything time can be attributed to in this pillar. Weekly targets set here drive the attainment figures above.
          </p>
        </div>
        <TrackerManagement
          trackers={pillarTrackers}
          showArchived={showArchived}
          onToggleArchived={onToggleArchived}
          restrictToPillar={pillar}
        />
      </section>
    </>
  );
}
