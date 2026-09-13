import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { Search, Upload } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/Card';
import { toast } from '@/state/toastStore';
import { useTrackers } from '@/state/useLiveData';
import { deleteResource, importFiles } from '@/services/resourceService';
import { isNativePlatform } from '@/lib/nativeBridge';
import { pickNativeFiles } from '@/lib/filePicker';
import { ResourceRow, AddLinkModal } from './ResourcePanel';
import type { Resource, ResourceType } from '@/types';

const ROW_HEIGHT = 56;
/** Above this count the list is virtualised; below it plain DOM is faster. */
const VIRTUALISE_ABOVE = 40;

/**
 * The whole resource library. Virtualised with react-window so a library of
 * thousands of files stays at a constant DOM size; the underlying Dexie query
 * is an index scan, not a full-table materialisation of blobs (blobs live in
 * `attachments` and are only read when something is opened).
 */
export function ResourceLibrary({ className }: { className?: string }) {
  const navigate = useNavigate();
  const trackers = useTrackers();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<ResourceType | 'all'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const resources = useLiveQuery(
    () => db.resources.orderBy('title').toArray(),
    [],
  ) ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((r) => {
      if (r.archived) return false;
      if (type !== 'all' && r.type !== type) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || (r.url ?? '').toLowerCase().includes(q);
    });
  }, [resources, query, type]);

  const onFiles = async (files: File[] | FileList | null) => {
    const list = files ? [...files] : [];
    if (!list.length) return;
    const trackerId = trackers[0]?.id;
    if (!trackerId) { toast.error('No tracker available', 'Create a tracker first.'); return; }
    const { imported, errors } = await importFiles(list, { trackerId });
    if (imported.length) toast.success(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}`);
    for (const e of errors) toast.error('Could not import', e);
  };

  const onImportClick = async () => {
    if (isNativePlatform()) {
      const picked = await pickNativeFiles();
      if (picked === null) { fileRef.current?.click(); return; }
      if (picked.length === 0) return; // cancelled
      await onFiles(picked);
      return;
    }
    fileRef.current?.click();
  };

  const Row = ({ index, style }: ListChildComponentProps) => {
    const resource = filtered[index]!;
    return (
      <div style={style} className="pb-1.5">
        <ul>
          <ResourceRow
            resource={resource}
            onOpen={() => navigate(`/practice/resource/${resource.id}`)}
            onRemove={() => void remove(resource)}
          />
        </ul>
      </div>
    );
  };

  const remove = async (resource: Resource) => {
    await deleteResource(resource.id);
    toast.success('Resource deleted', `"${resource.title}" removed from this browser.`);
  };

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search resources"
            className="pl-8"
          />
        </div>
        <Select
          className="w-40"
          value={type}
          onChange={(e) => setType(e.target.value as ResourceType | 'all')}
        >
          <option value="all">All types</option>
          {['book', 'video', 'course', 'pdf', 'link', 'note', 'other'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <Button iconLeft={<Upload className="h-4 w-4" />} onClick={() => void onImportClick()}>
          Import files
        </Button>
        <Button onClick={() => setAddOpen(true)}>Add link</Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }}
      />

      {filtered.length === 0 ? (
        <EmptyState
          title={resources.length === 0 ? 'No resources yet' : 'Nothing matches that filter'}
          description={
            resources.length === 0
              ? 'Import PDFs, images, documents or notes, or save external links. Files are stored in this browser and never uploaded.'
              : undefined
          }
        />
      ) : filtered.length > VIRTUALISE_ABOVE ? (
        <FixedSizeList
          height={Math.min(560, filtered.length * ROW_HEIGHT)}
          itemCount={filtered.length}
          itemSize={ROW_HEIGHT}
          width="100%"
        >
          {Row}
        </FixedSizeList>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((r) => (
            <ResourceRow
              key={r.id}
              resource={r}
              onOpen={() => navigate(`/practice/resource/${r.id}`)}
              onRemove={() => void remove(r)}
            />
          ))}
        </ul>
      )}

      <AddLinkModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultTrackerId={trackers[0]?.id ?? ''}
      />
    </div>
  );
}
