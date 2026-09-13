import { Download, FileWarning, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatBytes } from '@/services/backupService';
import { isNativePlatform } from '@/lib/nativeBridge';
import { shareBlobNative } from '@/lib/nativeShare';
import { toast } from '@/state/toastStore';
import type { Resource } from '@/types';

/**
 * Honest fallback for formats this app cannot render offline in a WebView
 * (DOC/DOCX/PPT/PPTX/XLS/XLSX). No fake preview — file metadata plus a
 * working "open elsewhere" path (native share sheet, or a download link on
 * the web) so the user can still reach the file via the OS's own app
 * associations.
 */
export function UnsupportedFormatViewer({
  resource, blob, extLabel,
}: { resource: Resource; blob: Blob; extLabel: string }) {
  const openElsewhere = async () => {
    if (isNativePlatform()) {
      const ok = await shareBlobNative(blob, resource.title, resource.title);
      if (!ok) toast.warning('Could not share', 'The share sheet is unavailable on this device.');
      return;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = resource.title;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface-base p-8 text-center">
      <FileWarning className="h-10 w-10 text-ink-faint" />
      <div>
        <h2 className="t-title">Preview not available</h2>
        <p className="t-muted mt-1 max-w-sm">
          {extLabel} files can't be rendered inside LifeOS without a heavy external dependency, so
          this is an honest "no preview" state rather than a broken one.
        </p>
      </div>
      <div className="rounded-card border border-line bg-surface-raised px-4 py-3 text-sm">
        <div className="text-ink">{resource.title}</div>
        <div className="t-meta mt-0.5">
          {formatBytes(blob.size)} · added {new Date(resource.createdAt).toLocaleDateString()}
        </div>
      </div>
      <Button
        variant="primary"
        iconLeft={isNativePlatform() ? <Share2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        onClick={() => void openElsewhere()}
      >
        {isNativePlatform() ? 'Open in another app' : 'Download'}
      </Button>
    </div>
  );
}
