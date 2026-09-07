import { Page } from './Page';
import { Card } from '@/components/ui/Card';

/**
 * Temporary module marker used only while the build is progressing phase by
 * phase. Each of these is replaced by the real module in its phase — nothing
 * here simulates functionality.
 */
export function PhasePending({ title, phase, description }: { title: string; phase: number; description: string }) {
  return (
    <Page title={title} subtitle={description}>
      <Card>
        <div className="t-section">Arriving in phase {phase}</div>
        <p className="t-muted mt-1">
          This module is not implemented yet. It is built in phase {phase} of the LifeOS build plan —
          see PROGRESS.md in the repository root for current status.
        </p>
      </Card>
    </Page>
  );
}
