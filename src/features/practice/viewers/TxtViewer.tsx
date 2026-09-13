import { useEffect, useState } from 'react';

/** Plain-text viewer — reads the blob as text and renders it monospaced. */
export function TxtViewer({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    blob.text()
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read this file.'); });
    return () => { cancelled = true; };
  }, [blob]);

  if (error) {
    return <div className="flex h-full items-center justify-center p-6 t-muted">{error}</div>;
  }
  if (text === null) {
    return <div className="flex h-full items-center justify-center p-6 t-muted">Loading…</div>;
  }
  return (
    <div className="h-full overflow-auto bg-surface-base p-4">
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-ink">{text}</pre>
    </div>
  );
}
