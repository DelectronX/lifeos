import { Page } from '@/components/layout/Page';
import { Card } from '@/components/ui/Card';
import { ResourceLibrary } from '@/components/resource/ResourceLibrary';

/**
 * Practice — the resource library's home.
 *
 * This hosts the existing ResourceLibrary component, relocated here from
 * Settings so it reads as a real destination rather than a buried admin tab.
 * A later wave adds native file-picker support and built-in viewers on top of
 * this same component; for now it is an unmodified reuse.
 */
export function PracticePage() {
  return (
    <Page
      title="Practice"
      subtitle="Every file and link you have attached anywhere. Files are held as Blobs in this browser's IndexedDB — nothing is ever uploaded."
    >
      <Card>
        <ResourceLibrary />
      </Card>
    </Page>
  );
}
