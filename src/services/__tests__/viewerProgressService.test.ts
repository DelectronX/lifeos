import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { deleteViewerProgress, getViewerProgress, saveViewerProgress } from '@/services/viewerProgressService';

/**
 * Viewer progress persistence — the resume-position guarantee for video (and
 * last-page/zoom for PDF). One row per resource; repeated saves must update
 * in place rather than accumulating duplicate rows.
 */
describe('viewerProgressService', () => {
  const resourceId = newId('res');

  beforeEach(async () => {
    await db.viewerProgress.clear();
  });

  it('returns null when no progress has been saved yet', async () => {
    expect(await getViewerProgress(resourceId)).toBeNull();
  });

  it('saves and reads back a video resume position', async () => {
    await saveViewerProgress(resourceId, { positionSeconds: 128.5 });
    const progress = await getViewerProgress(resourceId);
    expect(progress?.positionSeconds).toBe(128.5);
  });

  it('saves and reads back PDF last page + zoom', async () => {
    await saveViewerProgress(resourceId, { lastPage: 7, zoom: 1.5 });
    const progress = await getViewerProgress(resourceId);
    expect(progress?.lastPage).toBe(7);
    expect(progress?.zoom).toBe(1.5);
  });

  it('a second save updates the same row in place — never duplicates', async () => {
    await saveViewerProgress(resourceId, { positionSeconds: 10 });
    await saveViewerProgress(resourceId, { positionSeconds: 42 });
    const all = await db.viewerProgress.where('resourceId').equals(resourceId).toArray();
    expect(all).toHaveLength(1);
    expect(all[0]!.positionSeconds).toBe(42);
  });

  it('a partial patch does not clobber unrelated fields', async () => {
    await saveViewerProgress(resourceId, { lastPage: 3, zoom: 1 });
    await saveViewerProgress(resourceId, { positionSeconds: 5 });
    const progress = await getViewerProgress(resourceId);
    expect(progress?.lastPage).toBe(3);
    expect(progress?.zoom).toBe(1);
    expect(progress?.positionSeconds).toBe(5);
  });

  it('progress is isolated per resource', async () => {
    const other = newId('res');
    await saveViewerProgress(resourceId, { positionSeconds: 1 });
    await saveViewerProgress(other, { positionSeconds: 99 });
    expect((await getViewerProgress(resourceId))?.positionSeconds).toBe(1);
    expect((await getViewerProgress(other))?.positionSeconds).toBe(99);
  });

  it('deleteViewerProgress removes the row so a fresh read returns null', async () => {
    await saveViewerProgress(resourceId, { positionSeconds: 10 });
    await deleteViewerProgress(resourceId);
    expect(await getViewerProgress(resourceId)).toBeNull();
  });
});
