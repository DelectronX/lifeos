import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/Card';
import { WIDGET_REGISTRY } from './registry';
import type { DashboardWidgetType } from '@/types';

/**
 * The "Add widget" picker sheet. Lists every widget type not already on the
 * dashboard; tapping one adds it immediately and closes the sheet.
 */
export function AddWidgetSheet({
  open, onClose, availableTypes, onAdd,
}: {
  open: boolean;
  onClose: () => void;
  availableTypes: DashboardWidgetType[];
  onAdd: (type: DashboardWidgetType) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add a widget" description="Choose an insight to add to Home." size="lg">
      {availableTypes.length === 0 ? (
        <p className="t-muted">Every available widget is already on your Home.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {availableTypes.map((type) => {
            const def = WIDGET_REGISTRY[type];
            return (
              <Card
                key={type}
                interactive
                className="p-3"
                onClick={() => { onAdd(type); onClose(); }}
              >
                <div className="text-sm font-medium text-ink">{def.label}</div>
                <p className="t-meta mt-1">{def.description}</p>
              </Card>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
