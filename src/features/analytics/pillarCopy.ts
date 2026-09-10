import type { Pillar } from '@/types';

/**
 * Per-pillar copy. The *metrics* are identical for every pillar — they all come
 * from `computePillarMetrics` — only the question each section answers and the
 * action that generates data differ. Keeping the wording here is what lets one
 * component serve Fitness, Skills and Personal without four forks.
 *
 * Fitness deliberately carries no body-comparison framing: consistency and
 * duration only.
 */
export interface PillarCopy {
  title: string;
  question: string;
  /** Label for the count of timer sessions in this pillar. */
  sessionLabel: string;
  /** Heading for the per-tracker breakdown. */
  breakdownTitle: string;
  breakdownQuestion: string;
  /** What the user must do for any data to exist. */
  emptyAction: string;
  /** Question for the goals block. */
  goalsQuestion: string;
  habitsQuestion: string;
}

export const PILLAR_COPY: Record<Exclude<Pillar, 'system'>, PillarCopy> = {
  study: {
    title: 'Study',
    question: 'How much study time was recorded, and how consistently?',
    sessionLabel: 'Study sessions',
    breakdownTitle: 'By subject',
    breakdownQuestion: 'Minutes recorded per subject in this window.',
    emptyAction: 'Run a focus timer on a study task or complete a study block on the schedule.',
    goalsQuestion: 'Study goals and where they stand.',
    habitsQuestion: 'Study habits checked in during this window.',
  },
  fitness: {
    title: 'Fitness',
    question: 'How many sessions were done, for how long, and how regularly?',
    sessionLabel: 'Training sessions',
    breakdownTitle: 'By activity',
    breakdownQuestion: 'Minutes recorded per fitness tracker in this window.',
    emptyAction: 'Log a workout by completing a fitness block or running a timer against a fitness tracker.',
    goalsQuestion: 'Fitness goals and where they stand.',
    habitsQuestion: 'Fitness habits checked in during this window.',
  },
  skills: {
    title: 'Skills',
    question: 'How many hours went into deliberate practice, and on what?',
    sessionLabel: 'Practice sessions',
    breakdownTitle: 'By skill',
    breakdownQuestion: 'Minutes recorded per skill in this window.',
    emptyAction: 'Track practice by running a timer on a skills task or completing a skills block.',
    goalsQuestion: 'Skill goals, courses and projects tracked as goals.',
    habitsQuestion: 'Practice habits checked in during this window.',
  },
  personal: {
    title: 'Personal',
    question: 'How much of the period went to reading, hobbies and personal upkeep?',
    sessionLabel: 'Personal sessions',
    breakdownTitle: 'By area',
    breakdownQuestion: 'Minutes recorded per personal tracker in this window.',
    emptyAction: 'Check in a habit, complete a personal task, or run a timer against a personal tracker.',
    goalsQuestion: 'Personal goals and where they stand.',
    habitsQuestion: 'Habits checked in during this window.',
  },
};
