import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Link2, Timer } from 'lucide-react';
import { db } from '@/db/db';
import { IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { PdfViewer } from './viewers/PdfViewer';
import { VideoViewer } from './viewers/VideoViewer';
import { ImageViewer } from './viewers/ImageViewer';
import { TxtViewer } from './viewers/TxtViewer';
import { UnsupportedFormatViewer } from './viewers/UnsupportedFormatViewer';
import { StartFocusFromResource } from '@/features/focus/StartFocusFromResource';
import { ActiveTimerPanel } from '@/features/focus/ActiveTimerPanel';
import { useTimerReading } from '@/state/useTimer';
import { useFocusLockStore } from '@/state/focusLockStore';
import { useTrackerMap } from '@/state/useLiveData';
import type { Attachment, Resource } from '@/types';

type Kind = 'pdf' | 'video' | 'image' | 'txt' | 'unsupported' | 'link';

function kindFor(mime: string, name: string): { kind: Kind; label: string } {
  const lower = name.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return { kind: 'pdf', label: 'PDF' };
  if (mime.startsWith('image/')) return { kind: 'image', label: 'Image' };
  if (mime.startsWith('video/')) return { kind: 'video', label: 'Video' };
  if (mime.startsWith('text/') || /\.(txt|md|csv|log|json)$/i.test(lower)) return { kind: 'txt', label: 'Text' };
  if (/\.(docx?)$/i.test(lower) || mime.includes('word')) return { kind: 'unsupported', label: 'Word document' };
  if (/\.(pptx?)$/i.test(lower) || mime.includes('presentation')) return { kind: 'unsupported', label: 'PowerPoint presentation' };
  if (/\.(xlsx?)$/i.test(lower) || mime.includes('sheet') || mime.includes('excel')) return { kind: 'unsupported', label: 'Excel spreadsheet' };
  return { kind: 'unsupported', label: 'This file type' };
}

/**
 * Full-screen in-app viewer reached by tapping a resource in the Practice
 * library. Dispatches by MIME/extension to the right viewer; a resource with
 * no attachment (a saved link) gets its own honest state rather than a blank
 * screen.
 */
export function FileViewerPage() {
  const { resourceId } = useParams<{ resourceId: string }>();
  const navigate = useNavigate();
  const [resource, setResource] = useState<Resource | null | undefined>(undefined);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [focusDialogOpen, setFocusDialogOpen] = useState(false);
  const trackerMap = useTrackerMap();
  const { snapshot } = useTimerReading();
  const lockedSessionId = useFocusLockStore((s) => s.lockedSessionId);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      if (!resourceId) return;
      const r = (await db.resources.get(resourceId)) ?? null;
      if (cancelled) return;
      setResource(r);
      if (r?.attachmentId) {
        const att = (await db.attachments.get(r.attachmentId)) ?? null;
        if (cancelled) return;
        setAttachment(att);
        if (att) {
          url = URL.createObjectURL(att.blob);
          setObjectUrl(url);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [resourceId]);

  const info = useMemo(() => {
    if (!attachment) return null;
    return kindFor(attachment.mime, attachment.name);
  }, [attachment]);

  const sessionForThisResource = snapshot && snapshot.resourceId === resourceId ? snapshot : null;
  const tracker = resource ? trackerMap[resource.trackerId] : undefined;
  const focusLabel = resource ? (tracker ? `${resource.title} · ${tracker.name}` : resource.title) : '';

  if (resource === undefined) return null; // brief loading tick, avoids a flash of "not found"

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface-base">
      <header className="flex items-center gap-2 border-b border-line bg-surface-raised px-3 py-2">
        <IconButton label="Back" size="md" onClick={() => navigate('/practice')}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{resource?.title ?? 'Resource'}</div>
          {info ? <div className="t-meta">{info.label}</div> : null}
        </div>
        {resource && !sessionForThisResource ? (
          <IconButton label="Start focus session" size="md" onClick={() => setFocusDialogOpen(true)}>
            <Timer className="h-4 w-4" />
          </IconButton>
        ) : null}
      </header>

      {sessionForThisResource && lockedSessionId !== sessionForThisResource.id ? (
        <div className="border-b border-line bg-surface-raised px-3 py-3">
          <ActiveTimerPanel />
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {resource === null ? (
          <EmptyState title="Resource not found" description="It may have been deleted." />
        ) : !resource.attachmentId ? (
          resource.url ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <Link2 className="h-8 w-8 text-ink-faint" />
              <div>
                <h2 className="t-title">This is a saved link</h2>
                <p className="t-muted mt-1 max-w-sm break-all">{resource.url}</p>
              </div>
              <a
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[var(--r-md)] bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast"
              >
                Open link
              </a>
            </div>
          ) : (
            <EmptyState title="Nothing to preview" description="This resource has no file or link." />
          )
        ) : !attachment || !objectUrl || !info ? (
          <div className="flex h-full items-center justify-center t-muted">Loading…</div>
        ) : info.kind === 'pdf' ? (
          <PdfViewer resourceId={resource.id} blob={attachment.blob} />
        ) : info.kind === 'video' ? (
          <VideoViewer resourceId={resource.id} src={objectUrl} />
        ) : info.kind === 'image' ? (
          <ImageViewer src={objectUrl} alt={resource.title} />
        ) : info.kind === 'txt' ? (
          <TxtViewer blob={attachment.blob} />
        ) : (
          <UnsupportedFormatViewer resource={resource} blob={attachment.blob} extLabel={info.label} />
        )}
      </div>

      {resource ? (
        <StartFocusFromResource
          open={focusDialogOpen}
          onClose={() => setFocusDialogOpen(false)}
          resourceId={resource.id}
          resourceTitle={focusLabel}
          trackerId={resource.trackerId}
        />
      ) : null}
    </div>
  );
}
