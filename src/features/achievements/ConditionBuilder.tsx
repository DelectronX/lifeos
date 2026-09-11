import { Fragment } from 'react';
import { Check, Minus, Plus, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input, Select } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import { newId } from '@/lib/id';
import {
  COMPARISON_OPERATORS, OPERATOR_LABELS, addChild, isLeaf, removeNode, replaceNode,
  type ComparisonOperator, type Condition, type ConditionTrace, type GroupCondition,
  type GroupOperator, type LeafCondition, type TimeWindow, type TimeWindowKind,
} from '@/engines/conditionEngine';
import { METRIC_OPTIONS, TIME_WINDOW_OPTIONS, findMetricOption } from '@/config/rewards';

/**
 * Visual condition builder.
 *
 * It is a thin editor over the ConditionEngine AST: every control replaces a
 * node in an immutable tree and hands the new root upward. No evaluation
 * happens here — the live preview is rendered from a trace the engine produced,
 * so what the builder shows and what the reward engine decides can never drift.
 */

export interface ConditionBuilderProps {
  value: Condition;
  onChange: (next: Condition) => void;
  /** Trace from the last evaluation, keyed by node id for per-row status. */
  traceById?: ReadonlyMap<string, ConditionTrace>;
}

const GROUP_LABELS: Record<GroupOperator, string> = {
  and: 'All of these',
  or: 'Any of these',
  not: 'None of these',
};

function makeLeaf(): LeafCondition {
  return {
    id: newId('cnd'),
    type: 'leaf',
    metric: 'studyMinutes',
    operator: '>=',
    value: 60,
    window: { kind: 'this_week' },
  };
}

function makeGroup(type: GroupOperator): GroupCondition {
  return { id: newId('cnd'), type, children: [makeLeaf()] };
}

export function ConditionBuilder({ value, onChange, traceById }: ConditionBuilderProps) {
  return (
    <ConditionNode
      node={value}
      depth={0}
      traceById={traceById}
      onUpdate={(id, next) => onChange(replaceNode(value, id, next))}
      onRemove={(id) => {
        const next = removeNode(value, id);
        if (next) onChange(next);
      }}
      onAddChild={(groupId, child) => onChange(addChild(value, groupId, child))}
      isRoot
    />
  );
}

interface NodeProps {
  node: Condition;
  depth: number;
  isRoot?: boolean;
  traceById?: ReadonlyMap<string, ConditionTrace>;
  onUpdate: (id: string, next: Condition) => void;
  onRemove: (id: string) => void;
  onAddChild: (groupId: string, child: Condition) => void;
}

function ConditionNode(props: NodeProps) {
  const { node } = props;
  return isLeaf(node) ? <LeafRow {...props} node={node} /> : <GroupBox {...props} node={node} />;
}

/* ------------------------------------------------------------------ */
/* Group                                                               */
/* ------------------------------------------------------------------ */

function GroupBox({ node, depth, isRoot, traceById, onUpdate, onRemove, onAddChild }: NodeProps & { node: GroupCondition }) {
  const trace = traceById?.get(node.id);
  const met = trace?.met;

  return (
    <fieldset
      className={cn(
        'rounded-lg border p-3',
        depth === 0 ? 'border-line bg-surface-sunken/40' : 'border-line bg-surface-raised/50',
      )}
    >
      <legend className="sr-only">{GROUP_LABELS[node.type]}</legend>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          sizeVariant="sm"
          className="w-auto min-w-[9.5rem]"
          aria-label="Group type"
          value={node.type}
          onChange={(e) => onUpdate(node.id, { ...node, type: e.target.value as GroupOperator })}
        >
          {(Object.keys(GROUP_LABELS) as GroupOperator[]).map((key) => (
            <option key={key} value={key}>{GROUP_LABELS[key]}</option>
          ))}
        </Select>

        {typeof met === 'boolean' ? (
          <Badge tone={met ? 'positive' : 'outline'}>{met ? 'Met' : 'Not met'}</Badge>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <Button size="xs" variant="subtle" onClick={() => onAddChild(node.id, makeLeaf())}>
            <Plus className="h-3.5 w-3.5" /> Condition
          </Button>
          <Button size="xs" variant="subtle" onClick={() => onAddChild(node.id, makeGroup('or'))}>
            <Plus className="h-3.5 w-3.5" /> Group
          </Button>
          {!isRoot ? (
            <IconButton label="Remove group" size="xs" onClick={() => onRemove(node.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
        </div>
      </div>

      {node.children.length === 0 ? (
        <p className="t-meta px-1 py-2">
          This group is empty, so it can never be met. Add at least one condition.
        </p>
      ) : (
        <ul className="space-y-2">
          {node.children.map((child, index) => (
            <Fragment key={child.id}>
              {index > 0 ? (
                <li aria-hidden className="t-label pl-1 !text-ink-faint">
                  {node.type === 'or' ? 'or' : 'and'}
                </li>
              ) : null}
              <li>
                <ConditionNode
                  node={child}
                  depth={depth + 1}
                  traceById={traceById}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                  onAddChild={onAddChild}
                />
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Leaf                                                                */
/* ------------------------------------------------------------------ */

function LeafRow({ node, traceById, onUpdate, onRemove }: NodeProps & { node: LeafCondition }) {
  const option = findMetricOption(node.metric);
  const trace = traceById?.get(node.id);
  const met = trace?.met;
  const windowable = option?.windowable ?? true;

  const setWindowKind = (kind: TimeWindowKind) => {
    const window: TimeWindow = kind === 'rolling_days' ? { kind, days: node.window.days ?? 7 } : { kind };
    onUpdate(node.id, { ...node, window });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
            met === true
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-line bg-surface-sunken text-ink-faint',
          )}
          aria-hidden
        >
          {met === true ? <Check className="h-3 w-3" /> : met === false ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
        </span>

        <Select
          sizeVariant="sm"
          className="w-full min-w-[12rem] sm:w-auto sm:flex-1"
          aria-label="Metric"
          value={node.metric}
          onChange={(e) => {
            const next = findMetricOption(e.target.value);
            onUpdate(node.id, {
              ...node,
              metric: e.target.value,
              window: next && !next.windowable ? { kind: 'all_time' } : node.window,
            });
          }}
        >
          {METRIC_OPTIONS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </Select>

        <Select
          sizeVariant="sm"
          className="w-auto min-w-[7.5rem]"
          aria-label="Comparison"
          value={node.operator}
          onChange={(e) => onUpdate(node.id, { ...node, operator: e.target.value as ComparisonOperator })}
        >
          {COMPARISON_OPERATORS.map((op) => (
            <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
          ))}
        </Select>

        <span className="flex items-center gap-1.5">
          <Input
            sizeVariant="sm"
            numeric
            type="number"
            className="w-24"
            aria-label="Target value"
            value={String(node.value)}
            onChange={(e) => {
              const parsed = Number(e.target.value);
              onUpdate(node.id, { ...node, value: Number.isFinite(parsed) ? parsed : 0 });
            }}
          />
          {option?.unit ? <span className="t-meta shrink-0">{option.unit}</span> : null}
        </span>

        <Select
          sizeVariant="sm"
          className="w-auto min-w-[8.5rem]"
          aria-label="Time window"
          disabled={!windowable}
          value={windowable ? node.window.kind : 'all_time'}
          onChange={(e) => setWindowKind(e.target.value as TimeWindowKind)}
        >
          {TIME_WINDOW_OPTIONS.map((w) => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </Select>

        {windowable && node.window.kind === 'rolling_days' ? (
          <Input
            sizeVariant="sm"
            numeric
            type="number"
            min={1}
            className="w-20"
            aria-label="Rolling window length in days"
            value={String(node.window.days ?? 7)}
            onChange={(e) => {
              const days = Math.max(1, Math.floor(Number(e.target.value) || 1));
              onUpdate(node.id, { ...node, window: { kind: 'rolling_days', days } });
            }}
          />
        ) : null}

        <IconButton label="Remove condition" size="xs" className="ml-auto" onClick={() => onRemove(node.id)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {trace && trace.kind === 'leaf' ? (
        <p className={cn('t-meta mt-2 pl-7', trace.unknownMetric && 'text-critical')}>{trace.explanation}</p>
      ) : !windowable ? (
        <p className="t-meta mt-2 pl-7">This figure only exists as an all-time number.</p>
      ) : null}
    </div>
  );
}

/** Flattens a trace tree into a node-id lookup so rows can show their status. */
export function indexTrace(trace: ConditionTrace): Map<string, ConditionTrace> {
  const map = new Map<string, ConditionTrace>();
  const walk = (t: ConditionTrace) => {
    map.set(t.id, t);
    if (t.kind !== 'leaf') t.children.forEach(walk);
  };
  walk(trace);
  return map;
}
