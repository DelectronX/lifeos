import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { newId } from '@/lib/id';
import {
  createAnnotation, deleteAnnotation, deleteAnnotationsForResource,
  getAnnotationsForPage, getAnnotationsForResource, updateAnnotation,
} from '@/services/annotationService';

/**
 * Annotation persistence — the core guarantee of the PDF viewer's overlay:
 * highlight/freehand marks must survive a page change and a reopen, keyed
 * exactly to resource + page.
 */
describe('annotationService', () => {
  const resourceId = newId('res');

  beforeEach(async () => {
    await db.annotations.clear();
  });

  it('creates a highlight annotation with rects and reads it back', async () => {
    const created = await createAnnotation({
      resourceId, page: 1, kind: 'highlight', color: '#FACC15',
      rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
    });
    const page1 = await getAnnotationsForPage(resourceId, 1);
    expect(page1).toHaveLength(1);
    expect(page1[0]!.id).toBe(created.id);
    expect(page1[0]!.rects).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }]);
  });

  it('creates a freehand annotation with a point path', async () => {
    await createAnnotation({
      resourceId, page: 2, kind: 'freehand', color: '#F97373',
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.15 }, { x: 0.3, y: 0.2 }],
      strokeWidth: 0.006,
    });
    const page2 = await getAnnotationsForPage(resourceId, 2);
    expect(page2).toHaveLength(1);
    expect(page2[0]!.points).toHaveLength(3);
  });

  it('scopes annotations to the correct page — page 1 marks never leak into page 2', async () => {
    await createAnnotation({ resourceId, page: 1, kind: 'highlight', color: '#FACC15', rects: [{ x: 0, y: 0, w: 1, h: 1 }] });
    await createAnnotation({ resourceId, page: 2, kind: 'highlight', color: '#FACC15', rects: [{ x: 0, y: 0, w: 1, h: 1 }] });
    expect(await getAnnotationsForPage(resourceId, 1)).toHaveLength(1);
    expect(await getAnnotationsForPage(resourceId, 2)).toHaveLength(1);
    expect(await getAnnotationsForResource(resourceId)).toHaveLength(2);
  });

  it('persists across a simulated reopen (fresh reads hit the same rows)', async () => {
    await createAnnotation({ resourceId, page: 3, kind: 'underline', color: '#38BDF8', rects: [{ x: 0, y: 0, w: 0.5, h: 0.02 }] });
    // Simulate "closing and reopening the viewer" — just re-query fresh.
    const reopened = await getAnnotationsForPage(resourceId, 3);
    expect(reopened).toHaveLength(1);
    expect(reopened[0]!.kind).toBe('underline');
  });

  it('updateAnnotation patches fields and bumps updatedAt', async () => {
    const created = await createAnnotation({ resourceId, page: 1, kind: 'note', color: '#fff', text: 'first' });
    const before = created.updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    await updateAnnotation(created.id, { text: 'edited' });
    const [row] = await getAnnotationsForPage(resourceId, 1);
    expect(row!.text).toBe('edited');
    expect(row!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('deleteAnnotation removes exactly one row (erase tool)', async () => {
    const a = await createAnnotation({ resourceId, page: 1, kind: 'highlight', color: '#FACC15', rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] });
    const b = await createAnnotation({ resourceId, page: 1, kind: 'highlight', color: '#FACC15', rects: [{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }] });
    await deleteAnnotation(a.id);
    const remaining = await getAnnotationsForPage(resourceId, 1);
    expect(remaining.map((r) => r.id)).toEqual([b.id]);
  });

  it('deleteAnnotationsForResource clears every page (resource delete cascade)', async () => {
    await createAnnotation({ resourceId, page: 1, kind: 'highlight', color: '#FACC15', rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] });
    await createAnnotation({ resourceId, page: 2, kind: 'freehand', color: '#F97373', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    await deleteAnnotationsForResource(resourceId);
    expect(await getAnnotationsForResource(resourceId)).toHaveLength(0);
  });

  it('annotations for one resource never appear under another resource id', async () => {
    const otherId = newId('res');
    await createAnnotation({ resourceId, page: 1, kind: 'highlight', color: '#FACC15', rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] });
    await createAnnotation({ resourceId: otherId, page: 1, kind: 'highlight', color: '#FACC15', rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] });
    expect(await getAnnotationsForResource(resourceId)).toHaveLength(1);
    expect(await getAnnotationsForResource(otherId)).toHaveLength(1);
  });
});
