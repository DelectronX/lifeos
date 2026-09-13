import { create } from 'zustand';
import {
  applyAutoReschedule, findSlippedTasks, previewAutoReschedule, undoPlanRun,
  type AutoReschedulePreview,
} from '@/services/planService';
import { getSettings, updateSettings } from '@/services/settingsService';
import { toast } from './toastStore';
import { DEFAULT_AUTO_RESCHEDULE_PREFERENCES, type AutoReschedulePreferences } from '@/types';

/**
 * Drives the auto-reschedule engine from the UI.
 *
 * SPEC §40 is binding here: nothing may move invisibly. `off` never runs.
 * `suggest` always stops at a preview the user must accept. `automatic`
 * applies immediately but ALWAYS follows with an undoable toast describing
 * exactly what moved and why — the toast is not optional decoration, it is
 * the only thing standing between "automatic" and "invisible".
 */

export function readAutoReschedulePreferences(settings: { autoReschedule?: AutoReschedulePreferences }): AutoReschedulePreferences {
  return { ...DEFAULT_AUTO_RESCHEDULE_PREFERENCES, ...(settings.autoReschedule ?? {}) };
}

interface AutoRescheduleState {
  /** Count shown by the "N tasks need rescheduling" entry points. */
  slippedCount: number;
  preview: AutoReschedulePreview | null;
  dialogOpen: boolean;
  checking: boolean;

  refreshSlippedCount: () => Promise<void>;
  /** Manual trigger: always previews, regardless of the configured mode. */
  openReviewDialog: () => Promise<void>;
  closeReviewDialog: () => void;
  /** Called once at app start; behaviour depends on the configured mode. */
  runStartupCheck: () => Promise<void>;
}

export const useAutoRescheduleStore = create<AutoRescheduleState>((set, get) => ({
  slippedCount: 0,
  preview: null,
  dialogOpen: false,
  checking: false,

  refreshSlippedCount: async () => {
    try {
      const slipped = await findSlippedTasks();
      set({ slippedCount: slipped.length });
    } catch {
      // Non-fatal: the banner just stays hidden.
    }
  },

  openReviewDialog: async () => {
    set({ checking: true });
    try {
      const preview = await previewAutoReschedule();
      const hasAnything = preview.result.decisions.length > 0 || preview.result.needsUserInput.length > 0;
      set({ preview, dialogOpen: hasAnything, checking: false, slippedCount: preview.tasks.length });
      if (!hasAnything) {
        toast.success('Nothing needs rescheduling', 'Every open task is on track.');
      }
    } catch (e) {
      set({ checking: false });
      toast.error('Could not check for slipped tasks', e instanceof Error ? e.message : String(e));
    }
  },

  closeReviewDialog: () => set({ dialogOpen: false }),

  runStartupCheck: async () => {
    try {
      const settings = await getSettings();
      const prefs = readAutoReschedulePreferences(settings);

      if (prefs.mode === 'off') {
        await get().refreshSlippedCount();
        return;
      }

      const slipped = await findSlippedTasks();
      set({ slippedCount: slipped.length });
      if (slipped.length === 0) return;

      const preview = await previewAutoReschedule(slipped.map((t) => t.id));
      if (preview.result.decisions.length === 0) return;

      if (prefs.mode === 'suggest') {
        set({ preview, dialogOpen: true });
        return;
      }

      // automatic — apply immediately, but always surface what happened.
      const result = await applyAutoReschedule(preview);
      if (result.planRunId) {
        await updateSettings({
          autoReschedule: { ...prefs, lastRunAt: Date.now(), lastRunId: result.planRunId },
        });
        toast.withAction(
          `Auto-rescheduled ${result.updated} task${result.updated === 1 ? '' : 's'}`,
          result.explanation.join(' '),
          {
            label: 'Undo',
            onClick: async () => {
              const undo = await undoPlanRun(result.planRunId);
              toast[undo.ok ? 'success' : 'warning'](undo.ok ? 'Reverted' : 'Could not undo', undo.message);
              await get().refreshSlippedCount();
            },
          },
        );
      }
      await get().refreshSlippedCount();
    } catch (e) {
      toast.error('Auto-reschedule check failed', e instanceof Error ? e.message : String(e));
    }
  },
}));
