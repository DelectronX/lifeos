import { db } from '@/db/db';
import { newId } from '@/lib/id';
import type { Annotation, AnnotationKind, AnnotationPoint, AnnotationRect, ID } from '@/types';

/**
 * AnnotationService — PDF highlight/underline/freehand/note persistence.
 *
 * Annotations are keyed by resourceId + page (compound index) so opening a
 * page is a single index scan, never a full-table read. Nothing here touches
 * rendering; this is pure Dexie CRUD the PDF viewer's overlay layer calls
 * into.
 */

export interface AnnotationDraft {
  resourceId: ID;
  page: number;
  kind: AnnotationKind;
  color: string;
  rects?: AnnotationRect[];
  points?: AnnotationPoint[];
  strokeWidth?: number;
  text?: string;
  anchor?: AnnotationPoint;
}

export async function createAnnotation(draft: AnnotationDraft): Promise<Annotation> {
  const now = Date.now();
  const annotation: Annotation = {
    id: newId('ann'),
    createdAt: now,
    updatedAt: now,
    resourceId: draft.resourceId,
    page: draft.page,
    kind: draft.kind,
    color: draft.color,
    rects: draft.rects,
    points: draft.points,
    strokeWidth: draft.strokeWidth,
    text: draft.text,
    anchor: draft.anchor,
  };
  await db.annotations.add(annotation);
  return annotation;
}

export async function getAnnotationsForPage(resourceId: ID, page: number): Promise<Annotation[]> {
  return db.annotations.where('[resourceId+page]').equals([resourceId, page]).toArray();
}

export async function getAnnotationsForResource(resourceId: ID): Promise<Annotation[]> {
  return db.annotations.where('resourceId').equals(resourceId).toArray();
}

export async function updateAnnotation(id: ID, patch: Partial<Annotation>): Promise<void> {
  await db.annotations.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteAnnotation(id: ID): Promise<void> {
  await db.annotations.delete(id);
}

/** Removes every annotation belonging to a resource — called on resource delete. */
export async function deleteAnnotationsForResource(resourceId: ID): Promise<void> {
  await db.annotations.where('resourceId').equals(resourceId).delete();
}
