import { useRef, useState } from 'react';
import { FileCog } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/state/toastStore';
import { SettingsSection } from './SettingsSection';
import { applyConfig, type ConfigApplyResult } from '@/services/configService';
import { createSnapshot, importFromFile } from '@/services/backupService';
import { storage } from '@/storage';

/**
 * Applies a LifeOS configuration file (trackers, recurring schedule, cycles,
 * goals, achievement definitions, reward catalogue, XP numbers). Merges by
 * id/key: re-applying the same file changes nothing, and history, XP,
 * streaks and unlocked achievements are never reset.
 */
export function ConfigImportSettings() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConfigApplyResult | null>(null);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { format?: string };
      if (parsed?.format === 'lifeos-export') {
        const restored = await importFromFile(file, 'merge');
        if (restored.ok) {
          await storage.saveAll();
          toast.success('Backup merged', restored.message);
        } else {
          toast.error('Backup not imported', restored.message);
        }
        return;
      }
      await createSnapshot('pre_import', `Before applying configuration ${file.name}.`);
      const outcome = await applyConfig(parsed);
      setResult(outcome);
      if (outcome.ok) {
        await storage.saveAll();
        toast.success('Configuration applied', outcome.message);
      } else {
        toast.error('Configuration not applied', outcome.message);
      }
    } catch (e) {
      toast.error('Could not read the file', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const errors = result?.validation.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = result?.validation.issues.filter((i) => i.severity === 'warning') ?? [];

  return (
    <SettingsSection
      title="Apply configuration"
      description="Set up schedule, cycles, projects, achievements, rewards and XP from a LifeOS configuration file. Existing records are merged by id — nothing is deleted or reset."
    >
      <div>
        <Button iconLeft={<FileCog className="h-4 w-4" />} loading={busy} onClick={() => fileRef.current?.click()}>
          Apply configuration file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void onFile(file);
          }}
        />
      </div>
      {result ? (
        <div className="space-y-1 text-sm">
          <p className={result.ok ? 'text-ink' : 'text-critical'}>{result.message}</p>
          {[...errors, ...warnings].slice(0, 12).map((i, n) => (
            <p key={n} className={i.severity === 'error' ? 't-meta text-critical' : 't-meta text-caution'}>
              {i.where}: {i.message}
            </p>
          ))}
        </div>
      ) : null}
    </SettingsSection>
  );
}
