import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { Card, EmptyState } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PaperBuilder } from './PaperBuilder';
import { usePapers } from '@/state/useLiveData';
import { deletePaper } from '@/services/paperService';
import { toast } from '@/state/toastStore';
import { formatDuration, relativeDayLabel } from '@/lib/date';
import type { Paper, PaperStatus } from '@/types';

const STATUS_TONE: Record<PaperStatus, 'neutral' | 'accent' | 'positive' | 'caution'> = {
  draft: 'neutral',
  in_progress: 'caution',
  submitted: 'accent',
  reviewed: 'positive',
};

const STATUS_LABEL: Record<PaperStatus, string> = {
  draft: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  reviewed: 'Reviewed',
};

/** Paper list + entry point to the builder, runner and review. */
export function PaperList() {
  const papers = usePapers();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Paper | null>(null);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="t-muted">
          Build a multi-subject mock, run it with per-question timing, then review where the marks went.
        </p>
        <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setBuilderOpen(true)}>
          New paper
        </Button>
      </div>

      {papers.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No papers yet"
          description="Create a mock test with subject sections, a total duration and a question count."
          action={<Button variant="primary" onClick={() => setBuilderOpen(true)}>Create a paper</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {papers.map((p) => {
            const questions = p.sections.reduce((s, x) => s + x.questionCount, 0);
            const done = p.status === 'submitted' || p.status === 'reviewed';
            return (
              <li key={p.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-3" padded>
                  <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{p.title}</span>
                      <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    </div>
                    <div className="t-meta mt-0.5">
                      {relativeDayLabel(p.date)} · {p.sections.length} section{p.sections.length === 1 ? '' : 's'} ·{' '}
                      {questions} questions · {formatDuration(p.durationMinutes)}
                      {done ? ` · ${p.score}/${p.maxScore} marks` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/focus/paper/${p.id}`}>
                      <Button size="sm" variant={done ? 'ghost' : 'primary'}>
                        {p.status === 'in_progress' ? 'Resume' : done ? 'Open' : 'Start'}
                      </Button>
                    </Link>
                    {done ? (
                      <Link to={`/focus/paper/${p.id}/review`}>
                        <Button size="sm" variant="secondary">Review</Button>
                      </Link>
                    ) : null}
                    <IconButton label="Delete paper" size="sm" onClick={() => setPendingDelete(p)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <PaperBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        danger
        title="Delete paper?"
        confirmLabel="Delete"
        message={`"${pendingDelete?.title ?? ''}" and all of its questions, attempts and per-question timings will be removed.`}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          void deletePaper(target.id).then(() => toast.success('Paper deleted'));
        }}
      />
    </div>
  );
}
