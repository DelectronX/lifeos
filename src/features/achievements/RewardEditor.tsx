import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/Progress';
import { cn } from '@/lib/cn';
import { newId } from '@/lib/id';
import {
  cloneCondition, evaluateCondition, type Condition, type MetricSource, type RepeatMode,
} from '@/engines/conditionEngine';
import { REPEAT_OPTIONS, REWARD_PRESETS } from '@/config/rewards';
import { METRIC_LABELS, METRIC_UNITS } from '@/services/achievementService';
import type { RewardInput } from '@/services/rewardService';
import { ConditionBuilder, indexTrace } from './ConditionBuilder';

/**
 * Create/edit dialog for a custom reward.
 *
 * The live preview runs the real ConditionEngine against the real measured
 * metrics, so the sentence under the builder is exactly what the reward engine
 * will decide with — there is no separate "preview" code path to drift.
 */

export interface RewardEditorProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: RewardInput) => Promise<void> | void;
  metrics: MetricSource | null;
  /** Present when editing; absent when creating. */
  initial?: RewardInput;
  title: string;
}

export function RewardEditor({ open, onClose, onSubmit, metrics, initial, title }: RewardEditorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [treat, setTreat] = useState('');
  const [xpValue, setXpValue] = useState(0);
  const [repeat, setRepeat] = useState<RepeatMode>('weekly');
  const [condition, setCondition] = useState<Condition>(() => emptyRoot());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setTreat(initial?.treat ?? '');
    setXpValue(initial?.xpValue ?? 0);
    setRepeat(initial?.repeat ?? 'weekly');
    setCondition(initial?.condition ?? emptyRoot());
    setSaving(false);
  }, [open, initial]);

  const evaluation = useMemo(
    () => (metrics ? evaluateCondition(condition, metrics, new Date(), { labels: METRIC_LABELS, units: METRIC_UNITS }) : null),
    [condition, metrics],
  );
  const traceById = useMemo(
    () => (evaluation ? indexTrace(evaluation.trace) : undefined),
    [evaluation],
  );

  const nameError = name.trim().length === 0 ? 'Give the reward a name.' : null;
  const leafCount = evaluation?.leaves.length ?? 0;
  const conditionError = leafCount === 0 ? 'Add at least one condition.' : null;
  const canSave = !nameError && !conditionError && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSubmit({ name, description, treat, xpValue, repeat, condition });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="A reward is earned when the conditions below hold against your own recorded data."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save reward'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required error={nameError}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="A solid study week" />
          </Field>
          <Field label="Repeats" hint="How often this reward can be earned again.">
            <Select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatMode)}>
              {REPEAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Description" hint="What this reward is for, in your own words.">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Treat" hint="The thing you promise yourself. Optional.">
            <Input value={treat} onChange={(e) => setTreat(e.target.value)} placeholder="An evening off, guilt-free" />
          </Field>
          <Field label="XP" hint="Banked once per earning. Leave at 0 for no XP.">
            <Input
              numeric
              type="number"
              min={0}
              value={String(xpValue)}
              onChange={(e) => setXpValue(Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
        </div>

        {!initial ? (
          <div>
            <div className="t-label mb-1.5">Start from a preset</div>
            <div className="flex flex-wrap gap-1.5">
              {REWARD_PRESETS.map((preset) => (
                <Button
                  key={preset.key}
                  size="xs"
                  variant="subtle"
                  onClick={() => {
                    setName((cur) => cur || preset.name);
                    setDescription((cur) => cur || preset.description);
                    setXpValue(preset.xpValue);
                    setRepeat(preset.repeat);
                    setCondition(preset.build(() => newId('cnd')));
                  }}
                >
                  {preset.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="t-label">Conditions</span>
            {conditionError ? <span className="text-xs text-critical">{conditionError}</span> : null}
          </div>
          <ConditionBuilder value={condition} onChange={setCondition} traceById={traceById} />
        </div>

        <div className="rounded-lg border border-line bg-surface-sunken/50 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="t-label">Right now</span>
            {evaluation ? (
              <Badge tone={evaluation.met ? 'positive' : 'outline'}>
                {evaluation.met ? 'Met' : 'Not met'}
              </Badge>
            ) : null}
          </div>
          {evaluation ? (
            <>
              <p className={cn('text-sm', evaluation.met ? 'text-ink' : 'text-ink-muted')}>
                {evaluation.met ? evaluation.summary : `Not met — ${lowerFirst(evaluation.summary)}`}
              </p>
              <ProgressBar className="mt-2" value={evaluation.progress} size="sm" />
            </>
          ) : (
            <p className="t-meta">Measuring your records…</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function emptyRoot(): Condition {
  return { id: newId('cnd'), type: 'and', children: [] };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Deep-copies a condition with fresh ids, for the duplicate action. */
export function freshCopy(condition: Condition): Condition {
  return cloneCondition(condition, () => newId('cnd'));
}
