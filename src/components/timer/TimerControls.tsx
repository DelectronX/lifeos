import { Check, Pause, Play, SkipForward, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * The control row shared by the focus panel and the compact mini-timer.
 * Every button here is wired by the caller — there are no inert controls.
 */
export function TimerControls({
  running, onPause, onResume, onStop, onComplete, onSkipPhase, compact, disabled,
}: {
  running: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onComplete?: () => void;
  /** Pomodoro only: jump to the next phase now. */
  onSkipPhase?: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const size = compact ? 'sm' : 'md';
  return (
    <div className={compact ? 'flex items-center gap-1.5' : 'flex flex-wrap items-center justify-center gap-2'}>
      {running ? (
        <Button size={size} variant="secondary" iconLeft={<Pause className="h-4 w-4" />} onClick={onPause} disabled={disabled}>
          Pause
        </Button>
      ) : (
        <Button size={size} variant="primary" iconLeft={<Play className="h-4 w-4" />} onClick={onResume} disabled={disabled}>
          Resume
        </Button>
      )}
      {onSkipPhase ? (
        <Button size={size} variant="ghost" iconLeft={<SkipForward className="h-4 w-4" />} onClick={onSkipPhase} disabled={disabled}>
          Next phase
        </Button>
      ) : null}
      <Button size={size} variant="secondary" iconLeft={<Square className="h-3.5 w-3.5" />} onClick={onStop} disabled={disabled}>
        Stop
      </Button>
      {onComplete ? (
        <Button size={size} variant="primary" iconLeft={<Check className="h-4 w-4" />} onClick={onComplete} disabled={disabled}>
          Complete
        </Button>
      ) : null}
    </div>
  );
}
