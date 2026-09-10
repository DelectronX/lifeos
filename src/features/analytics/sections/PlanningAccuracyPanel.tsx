import { Gauge } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { MeterRow } from '@/components/charts/Charts';
import { DataTable, type Column } from '@/components/charts/DataTable';
import type { PlanningAccuracy } from '@/engines/analytics';
import type { DurationPrediction, PredictionConfidence } from '@/engines/durationPrediction';
import {
  AnalyticsSection, InsightNote, NoData, StatCard, StatGrid, mins, pct,
} from '../components/AnalyticsPrimitives';

const CONFIDENCE_TONE: Record<PredictionConfidence, BadgeTone> = {
  none: 'neutral',
  low: 'neutral',
  medium: 'accent',
  high: 'positive',
};

const GROUP_LABEL: Record<DurationPrediction['groupKind'], string> = {
  global: 'Everything',
  tracker: 'Tracker',
  task_type: 'Task type',
  subject: 'Subject',
};

/**
 * The engine groups the same tasks several ways, so a small history often
 * yields four groups describing one identical fact ("Maths runs 50% long").
 * Showing each is chart soup, so only genuinely different sentences survive —
 * the per-group table below still lists everything.
 */
function distinctPatterns(predictions: DurationPrediction[]): DurationPrediction[] {
  const seen = new Set<string>();
  const out: DurationPrediction[] = [];
  for (const p of predictions) {
    if (!p.systematicOverrun && !p.systematicUnderrun) continue;
    // Two groups say the same thing when their numbers coincide.
    const fingerprint = `${p.sampleSize}|${p.medianOverrunRatio.toFixed(2)}|${p.meanEstimatedMinutes}|${p.meanActualMinutes}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(p);
    if (out.length === 4) break;
  }
  return out;
}

/**
 * Planning accuracy, straight from the DurationPredictionEngine.
 *
 * It presents the engine's own pattern sentences with their sample sizes, so a
 * pattern drawn from four tasks cannot be mistaken for one drawn from forty.
 * Nothing here tells the user to change an estimate — the engine's suggestions
 * are advisory and stay that way.
 */
export function PlanningAccuracyPanel({ planning }: { planning: PlanningAccuracy }) {
  const columns: Column<DurationPrediction>[] = [
    { key: 'label', header: 'Group', primary: true, cell: (p) => p.groupLabel },
    { key: 'kind', header: 'Kind', cell: (p) => <span className="t-meta">{GROUP_LABEL[p.groupKind]}</span> },
    { key: 'samples', header: 'Samples', align: 'right', cell: (p) => <span className="t-num">{p.sampleSize}</span> },
    {
      key: 'estimate',
      header: 'Estimated → actual',
      align: 'right',
      cell: (p) => <span className="t-num">{mins(p.meanEstimatedMinutes)} → {mins(p.meanActualMinutes)}</span>,
    },
    {
      key: 'ratio',
      header: 'Median ratio',
      align: 'right',
      cell: (p) => <span className="t-num">{p.medianOverrunRatio.toFixed(2)}×</span>,
    },
    {
      key: 'confidence',
      header: 'Confidence',
      align: 'right',
      cell: (p) => <Badge tone={CONFIDENCE_TONE[p.confidence]}>{p.confidence}</Badge>,
    },
  ];

  if (planning.sampleSize === 0) {
    return (
      <AnalyticsSection title="Planning accuracy" question="Do estimates match reality?">
        <NoData
          icon={<Gauge className="h-7 w-7" />}
          title="Not enough evidence yet"
          action="Give tasks an estimate and record real time against them (a timer session or a completed block). Once a handful are done, the estimate-versus-actual pattern appears here."
        />
      </AnalyticsSection>
    );
  }

  const total = planning.accurateEstimates + planning.underestimated + planning.overestimated;

  return (
    <AnalyticsSection title="Planning accuracy" question="Do estimates match reality?">
      <StatGrid>
        <StatCard label="Sample size" value={planning.sampleSize} sub="Completed tasks with estimate and real time" />
        <StatCard label="Within 15%" value={pct(planning.accuracyRate)} sub={`${planning.accurateEstimates} of ${total} estimates`} />
        <StatCard
          label="Median ratio"
          value={`${planning.medianRatio.toFixed(2)}×`}
          sub={planning.medianRatio > 1 ? 'Work typically runs longer than planned' : planning.medianRatio < 1 ? 'Work typically finishes early' : 'Estimates land on the nose'}
        />
        <StatCard label="Typical estimate" value={mins(planning.meanEstimatedMinutes)} sub={`Actually took ${mins(planning.meanActualMinutes)}`} />
      </StatGrid>

      <Card className="mt-4 space-y-3">
        <MeterRow label="Landed within 15%" value={planning.accurateEstimates} max={Math.max(total, 1)} valueLabel={String(planning.accurateEstimates)} color="teal" />
        <MeterRow label="Ran long" value={planning.underestimated} max={Math.max(total, 1)} valueLabel={String(planning.underestimated)} color="amber" />
        <MeterRow label="Finished early" value={planning.overestimated} max={Math.max(total, 1)} valueLabel={String(planning.overestimated)} color="sky" />
        <InsightNote>{planning.summary}</InsightNote>
      </Card>

      {planning.predictions.length > 0 ? (
        <>
          <div className="mt-6 space-y-2">
            {distinctPatterns(planning.predictions).map((p) => (
              <InsightNote key={`${p.groupKind}-${p.groupKey}`}>
                {p.pattern}{' '}
                <span className="t-num text-ink-faint">({p.sampleSize} sample{p.sampleSize === 1 ? '' : 's'}, {p.confidence} confidence)</span>
              </InsightNote>
            ))}
          </div>

          <Card className="mt-4">
            <div className="t-section">Per group</div>
            <div className="t-meta mb-3 mt-0.5">
              Only groups with enough samples to be meaningful are shown. These are observations, not instructions —
              your estimate is never changed automatically.
            </div>
            <DataTable rows={planning.predictions} columns={columns} rowKey={(p) => `${p.groupKind}-${p.groupKey}`} />
          </Card>
        </>
      ) : (
        <InsightNote className="mt-4">
          No individual tracker, task type or subject has enough completed tasks yet to report a reliable pattern of
          its own. The overall figures above still hold.
        </InsightNote>
      )}
    </AnalyticsSection>
  );
}
