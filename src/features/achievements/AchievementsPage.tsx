import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Lock, Trophy } from 'lucide-react';
import { Page, PageSection } from '@/components/layout/Page';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { ProgressBar, Ring, Stat } from '@/components/ui/Progress';
import { cn } from '@/lib/cn';
import { formatDateKeyShort, toDateKey } from '@/lib/date';
import { levelProgress } from '@/engines/xp';
import { useLiveProfile, useSchedulingConfig } from '@/state/useLiveData';
import { ACHIEVEMENT_CATEGORY_LABELS } from '@/config/achievements';
import {
  ACHIEVEMENT_CATEGORY_ORDER, evaluateAchievements, groupByCategory,
  type AchievementView,
} from '@/services/achievementService';
import { getRecentXP, groupXPByReason } from '@/services/xpService';
import type { AchievementCategory } from '@/types';
import { RewardsSection } from './RewardsSection';

type StatusFilter = 'all' | 'unlocked' | 'locked';
type CategoryFilter = 'all' | AchievementCategory;
type Section = 'achievements' | 'rewards';

/**
 * Achievements are read-only reflections of stored data: the page recomputes
 * every stat from records on each visit, so what you see is what is measurable
 * right now — nothing is cached into a lie. Rewards sit alongside them and are
 * evaluated from exactly the same measured numbers.
 */
export function AchievementsPage() {
  const profile = useLiveProfile();
  const config = useSchedulingConfig();
  const [section, setSection] = useState<Section>('achievements');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const evaluation = useLiveQuery(() => evaluateAchievements(), []);
  const recentXP = useLiveQuery(() => getRecentXP(40), []) ?? [];

  const level = profile ? levelProgress(profile.totalXP, config.xp) : null;
  const groups = useMemo(
    () => (evaluation ? groupByCategory(evaluation.views) : []),
    [evaluation],
  );

  const unlocked = evaluation?.views.filter((v) => v.unlocked).length ?? 0;
  const total = evaluation?.views.length ?? 0;
  const xpByReason = useMemo(() => groupXPByReason(recentXP), [recentXP]);

  const visibleGroups = groups.filter((g) => category === 'all' || g.category === category);

  return (
    <Page
      title="Achievements"
      subtitle="Every achievement is a threshold on a number counted from your own records. Nothing is awarded for creating things."
    >
      <div className="mb-6 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <Ring value={level?.progress ?? 0} size={72} stroke={7}>
              <div className="text-center">
                <div className="t-num text-lg font-semibold leading-none text-ink">{level?.level ?? 1}</div>
                <div className="t-label mt-0.5">Level</div>
              </div>
            </Ring>
            <div className="min-w-0">
              <div className="t-num text-xl font-semibold text-ink">
                {(profile?.totalXP ?? 0).toLocaleString()} XP
              </div>
              <div className="t-meta mt-0.5">
                {Math.round(level?.into ?? 0)} / {Math.round(level?.span ?? 0)} toward level {(level?.level ?? 1) + 1}
              </div>
              <div className="t-meta">
                Streak {profile?.currentStreak ?? 0} day{(profile?.currentStreak ?? 0) === 1 ? '' : 's'} · best {profile?.longestStreak ?? 0}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <Stat
            label="Unlocked"
            value={`${unlocked} / ${total}`}
            sub={total > 0 ? `${Math.round((unlocked / total) * 100)}% of every achievement` : 'Loading…'}
          />
          <ProgressBar className="mt-3" value={total > 0 ? unlocked / total : 0} size="sm" />
        </Card>

        <Card>
          <div className="t-label mb-2">Where your XP came from</div>
          {xpByReason.length === 0 ? (
            <p className="t-meta">No XP recorded yet. Complete a task, session or revision to start.</p>
          ) : (
            <ul className="space-y-1.5">
              {xpByReason.slice(0, 4).map((row) => (
                <li key={row.reason} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-ink">{row.label}</span>
                  <span className="t-num shrink-0 text-xs text-ink-muted">
                    {row.amount} XP · {row.count}x
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Tabs
        className="mb-5"
        value={section}
        onChange={setSection}
        items={[
          { value: 'achievements', label: 'Achievements', count: total },
          { value: 'rewards', label: 'Rewards' },
        ]}
      />

      {section === 'rewards' ? (
        <RewardsSection />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Tabs
              variant="pill"
              value={status}
              onChange={setStatus}
              items={[
                { value: 'all', label: 'All', count: total },
                { value: 'unlocked', label: 'Unlocked', count: unlocked },
                { value: 'locked', label: 'In progress', count: total - unlocked },
              ]}
            />
            <CategoryFilterBar value={category} onChange={setCategory} />
          </div>

          {!evaluation ? (
            <Card><p className="t-muted">Measuring your records…</p></Card>
          ) : total === 0 ? (
            <EmptyState icon={<Trophy className="h-6 w-6" />} title="No achievement definitions" description="Achievements are seeded on first run." />
          ) : (
            visibleGroups.map((group) => {
              const views = group.views.filter(
                (v) => status === 'all' || (status === 'unlocked' ? v.unlocked : !v.unlocked),
              );
              if (views.length === 0) return null;
              return (
                <PageSection
                  key={group.category}
                  title={ACHIEVEMENT_CATEGORY_LABELS[group.category]}
                  description={`${group.unlocked} of ${group.views.length} unlocked`}
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {views.map((view) => <AchievementCard key={view.definition.key} view={view} />)}
                  </div>
                </PageSection>
              );
            })
          )}
        </>
      )}
    </Page>
  );
}

function CategoryFilterBar({
  value, onChange,
}: { value: CategoryFilter; onChange: (v: CategoryFilter) => void }) {
  const options: CategoryFilter[] = ['all', ...ACHIEVEMENT_CATEGORY_ORDER];
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by category">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150',
            value === option
              ? 'border-accent/30 bg-accent-soft text-accent-ink'
              : 'border-line text-ink-muted hover:text-ink',
          )}
        >
          {option === 'all' ? 'Every category' : ACHIEVEMENT_CATEGORY_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

function AchievementCard({ view }: { view: AchievementView }) {
  const { definition } = view;
  return (
    <Card className={cn(!view.unlocked && 'bg-surface-raised/60')}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
            view.unlocked
              ? 'border-accent/25 bg-accent-soft text-accent-ink'
              : 'border-line bg-surface-sunken text-ink-faint',
          )}
        >
          {view.unlocked ? <Trophy className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate text-sm font-medium text-ink">{definition.title}</span>
            <Badge tone={view.unlocked ? 'positive' : 'outline'}>Tier {definition.tier}</Badge>
          </div>
          <p className="t-meta mt-0.5">{definition.description}</p>
        </div>
      </div>

      <div className="mt-3">
        <ProgressBar value={view.progress} size="sm" color={view.unlocked ? 'teal' : 'indigo'} />
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="t-meta">{view.progressLabel}</span>
          <span className="t-meta">
            {view.unlocked && view.unlockedAt
              ? `Unlocked ${formatDateKeyShort(toDateKey(view.unlockedAt))}`
              : definition.xpReward > 0
                ? `+${definition.xpReward} XP`
                : null}
          </span>
        </div>
      </div>
    </Card>
  );
}
