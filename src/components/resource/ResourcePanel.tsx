import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen, Download, ExternalLink, FileText, Film, GraduationCap, Link2,
  NotebookPen, Paperclip, Pencil, Plus, Trash2, Upload,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/state/toastStore';
import { useTrackers } from '@/state/useLiveData';
import { formatBytes } from '@/services/backupService';
import {
  attachResource, createLinkResource, deleteResource, detachResource, downloadResource,
  getResourcesFor, importFiles, openResourceInNewTab, renameResource,
} from '@/services/resourceService';
import type { ID, Resource, ResourceType } from '@/types';

/**
 * Attachment panel for a task / block / goal.
 *
 * Files are copied into IndexedDB as Blobs. Nothing is uploaded anywhere —
 * there is no network call in the resource path at all, which is stated in the
 * UI so the guarantee is visible, not just true.
 */
export function ResourcePanel({
  ownerKind, ownerId, trackerId, className,
}: {
  ownerKind: 'task' | 'block' | 'goal';
  ownerId: ID;
  /** Tracker assigned to newly created resources. */
  trackerId: ID;
  className?: string;
}) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<Resource | null>(null);
  const [removing, setRemoving] = useState<Resource | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setResources(await getResourcesFor(ownerKind, ownerId));
  }, [ownerKind, ownerId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    const target = ownerKind === 'task'
      ? { taskId: ownerId }
      : ownerKind === 'block' ? { blockId: ownerId } : { goalId: ownerId };
    const { imported, errors } = await importFiles([...files], { trackerId, ...target });
    for (const r of imported) await attachResource(r.id, ownerKind, ownerId);
    setBusy(false);
    if (imported.length) toast.success(`Attached ${imported.length} file${imported.length === 1 ? '' : 's'}`, 'Stored locally in this browser.');
    for (const e of errors) toast.error('Could not import', e);
    await refresh();
  };

  return (
    <div className={cn('rounded-card border border-line bg-surface-raised p-3', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="t-label inline-flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Resources ({resources.length})
        </div>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            iconLeft={<Upload className="h-3 w-3" />}
            loading={busy}
            onClick={() => fileRef.current?.click()}
          >
            File
          </Button>
          <Button size="xs" iconLeft={<Link2 className="h-3 w-3" />} onClick={() => setAddOpen(true)}>
            Link
          </Button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }}
      />

      {resources.length === 0 ? (
        <p className="t-meta">
          Nothing attached. Add a PDF, image, document, note or an external link — files are stored
          in this browser and never uploaded.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {resources.map((r) => (
            <ResourceRow
              key={r.id}
              resource={r}
              onRename={() => setRenaming(r)}
              onRemove={() => setRemoving(r)}
              onDetach={async () => {
                await detachResource(r.id, ownerKind, ownerId);
                await refresh();
                toast.show('Detached', `"${r.title}" is no longer attached here. The resource itself is kept.`);
              }}
            />
          ))}
        </ul>
      )}

      <AddLinkModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultTrackerId={trackerId}
        onCreated={async (resource) => {
          await attachResource(resource.id, ownerKind, ownerId);
          await refresh();
        }}
      />

      <RenameModal
        resource={renaming}
        onClose={() => setRenaming(null)}
        onDone={refresh}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        danger
        title="Delete this resource?"
        confirmLabel="Delete"
        message={
          removing?.attachmentId
            ? `"${removing.title}" and its stored file will be removed from this browser. This cannot be undone.`
            : `"${removing?.title}" will be removed everywhere it is attached.`
        }
        onConfirm={async () => {
          if (!removing) return;
          await deleteResource(removing.id);
          await refresh();
          toast.success('Resource deleted');
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

const TYPE_ICONS: Record<ResourceType, typeof FileText> = {
  book: BookOpen,
  video: Film,
  course: GraduationCap,
  pdf: FileText,
  link: Link2,
  note: NotebookPen,
  other: Paperclip,
};

export function ResourceRow({
  resource, onRename, onRemove, onDetach,
}: {
  resource: Resource;
  onRename?: () => void;
  onRemove?: () => void;
  onDetach?: () => void;
}) {
  const Icon = TYPE_ICONS[resource.type] ?? Paperclip;
  const isFile = Boolean(resource.attachmentId);

  return (
    <li className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
      <Icon className="h-4 w-4 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{resource.title}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{resource.type}</Badge>
          {isFile && resource.sizeBytes ? (
            <span className="t-num text-2xs text-ink-faint">{formatBytes(resource.sizeBytes)}</span>
          ) : null}
          {!isFile && resource.url ? (
            <span className="truncate text-2xs text-ink-faint">{resource.url}</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label="Open"
          size="xs"
          onClick={async () => {
            const ok = await openResourceInNewTab(resource.id);
            if (!ok) toast.warning('Could not open', 'Your browser blocked the new tab, or the resource has no target.');
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </IconButton>
        {isFile ? (
          <IconButton label="Download" size="xs" onClick={() => void downloadResource(resource.id)}>
            <Download className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        {onRename ? (
          <IconButton label="Rename" size="xs" onClick={onRename}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        {onDetach ? (
          <IconButton label="Detach" size="xs" onClick={onDetach}>
            <Link2 className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        {onRemove ? (
          <IconButton label="Delete" size="xs" variant="ghost" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-critical" />
          </IconButton>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */

export function AddLinkModal({
  open, onClose, defaultTrackerId, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultTrackerId: ID;
  onCreated?: (resource: Resource) => void | Promise<void>;
}) {
  const trackers = useTrackers();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [trackerId, setTrackerId] = useState(defaultTrackerId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setTitle(''); setUrl(''); setTrackerId(defaultTrackerId); setError(null); }
  }, [open, defaultTrackerId]);

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed) { setError('A URL is required.'); return; }
    try {
      // Reject anything that is not a real absolute URL so "open" cannot fail.
      const parsed = new URL(trimmed);
      if (!/^https?:$/.test(parsed.protocol)) {
        setError('Only http and https links are supported.');
        return;
      }
    } catch {
      setError('That is not a valid URL. Include https://');
      return;
    }
    const resource = await createLinkResource({
      title: title.trim() || trimmed,
      url: trimmed,
      trackerId,
    });
    await onCreated?.(resource);
    toast.success('Link added');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a link"
      description="Stored as a reference only — the page is never fetched or cached."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => void submit()}>
            Add link
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="URL" required error={error}>
          <Input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            placeholder="https://example.com/notes.pdf"
            autoFocus
          />
        </Field>
        <Field label="Title" hint="Defaults to the URL.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Tracker">
          <Select value={trackerId} onChange={(e) => setTrackerId(e.target.value)}>
            {trackers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function RenameModal({
  resource, onClose, onDone,
}: {
  resource: Resource | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  useEffect(() => { setValue(resource?.title ?? ''); }, [resource]);

  return (
    <Modal
      open={resource !== null}
      onClose={onClose}
      title="Rename resource"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (!resource) return;
              await renameResource(resource.id, value);
              await onDone();
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
