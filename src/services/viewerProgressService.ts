import { db } from '@/db/db';
import { newId } from '@/lib/id';
import type { ID, ViewerProgress } from '@/types';

/**
 * ViewerProgressService — resume position for video, and last page/zoom for
 * PDFs, one row per resource (unique `resourceId` index means "get or
 * create" never races into a duplicate).
 */

export async function getViewerProgress(resourceId: ID): Promise<ViewerProgress | null> {
  return (await db.viewerProgress.where('resourceId').equals(resourceId).first()) ?? null;
}

export async function saveViewerProgress(
  resourceId: ID,
  patch: Partial<Pick<ViewerProgress, 'positionSeconds' | 'lastPage' | 'zoom'>>,
): Promise<void> {
  const now = Date.now();
  const existing = await getViewerProgress(resourceId);
  if (existing) {
    await db.viewerProgress.update(existing.id, { ...patch, updatedAt: now });
    return;
  }
  const row: ViewerProgress = {
    id: newId('vwp'),
    createdAt: now,
    updatedAt: now,
    resourceId,
    ...patch,
  };
  await db.viewerProgress.add(row);
}

export async function deleteViewerProgress(resourceId: ID): Promise<void> {
  await db.viewerProgress.where('resourceId').equals(resourceId).delete();
}
