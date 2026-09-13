import { db } from '@/db/db';
import { newId } from '@/lib/id';
import { logActivity } from './activityService';
import type { Attachment, ID, Resource, ResourceType } from '@/types';

/**
 * ResourceService — files and links attached to the things you work on.
 *
 * Two kinds of resource share one record:
 *   - a FILE, whose bytes live in the `attachments` table as a Blob inside
 *     IndexedDB. It is read from the user's disk once and never leaves the
 *     device; there is no upload path in this codebase.
 *   - a LINK, which is just a URL.
 *
 * Attachment links are stored as multi-entry indexed arrays on the resource
 * (`taskIds` / `blockIds` / `goalIds`) so "what is attached to this task" is an
 * index lookup rather than a scan of every resource.
 */

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface ResourceDraft {
  title: string;
  type?: ResourceType;
  trackerId: ID;
  url?: string;
  unit?: string;
  totalUnits?: number | null;
  tags?: string[];
  notes?: string;
}

export interface AttachTarget {
  taskId?: ID | null;
  blockId?: ID | null;
  goalId?: ID | null;
}

function baseResource(draft: ResourceDraft, now: number): Resource {
  return {
    id: newId('res'),
    createdAt: now,
    updatedAt: now,
    title: draft.title.trim() || 'Untitled resource',
    type: draft.type ?? (draft.url ? 'link' : 'other'),
    trackerId: draft.trackerId,
    url: draft.url,
    attachmentId: null,
    unit: draft.unit ?? 'items',
    currentUnit: 0,
    totalUnits: draft.totalUnits ?? null,
    tags: draft.tags ?? [],
    archived: false,
    notes: draft.notes,
    taskIds: [],
    blockIds: [],
    goalIds: [],
  };
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

/** Registers an external URL as a resource. Nothing is fetched. */
export async function createLinkResource(
  draft: ResourceDraft & { url: string },
  target: AttachTarget = {},
): Promise<Resource> {
  const now = Date.now();
  const resource: Resource = {
    ...baseResource(draft, now),
    type: draft.type ?? guessTypeFromUrl(draft.url),
    url: draft.url.trim(),
  };
  applyTarget(resource, target);
  await db.resources.add(resource);
  return resource;
}

/** Guesses a sensible type so the icon is right without asking the user. */
export function guessTypeFromUrl(url: string): ResourceType {
  const lower = url.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(lower)) return 'video';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/coursera|udemy|edx|khanacademy/.test(lower)) return 'course';
  return 'link';
}

export function typeFromMime(mime: string, name: string): ResourceType {
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'other';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/') || /\.(md|txt)$/i.test(name)) return 'note';
  return 'other';
}

export interface ImportFileResult {
  ok: boolean;
  resource: Resource | null;
  error: string | null;
}

/**
 * Imports a local file. The bytes are copied into IndexedDB as a Blob and the
 * original file handle is dropped — the app keeps working with the file even
 * if the user later moves or deletes it on disk.
 */
export async function importFile(
  file: File,
  options: { trackerId: ID; title?: string; tags?: string[]; notes?: string } & AttachTarget,
): Promise<ImportFileResult> {
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      resource: null,
      error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB so the browser's storage quota is not exhausted — link to it instead.`,
    };
  }

  const now = Date.now();
  const mime = file.type || 'application/octet-stream';

  const attachment: Attachment = {
    id: newId('att'),
    createdAt: now,
    updatedAt: now,
    name: file.name,
    mime,
    size: file.size,
    blob: file.slice(0, file.size, mime),
    resourceId: null,
    taskId: options.taskId ?? null,
    blockId: options.blockId ?? null,
    goalId: options.goalId ?? null,
  };

  const resource: Resource = {
    ...baseResource(
      {
        title: options.title ?? file.name,
        trackerId: options.trackerId,
        tags: options.tags,
        notes: options.notes,
      },
      now,
    ),
    type: typeFromMime(mime, file.name),
    attachmentId: attachment.id,
    mime,
    sizeBytes: file.size,
  };
  attachment.resourceId = resource.id;
  applyTarget(resource, options);

  try {
    await db.transaction('rw', [db.resources, db.attachments], async () => {
      await db.attachments.add(attachment);
      await db.resources.add(resource);
    });
  } catch (e) {
    return {
      ok: false,
      resource: null,
      error: `Could not store "${file.name}": ${e instanceof Error ? e.message : String(e)}. The browser's storage quota may be full.`,
    };
  }

  return { ok: true, resource, error: null };
}

/** Imports several files, reporting per-file failures instead of aborting. */
export async function importFiles(
  files: readonly File[],
  options: { trackerId: ID } & AttachTarget,
): Promise<{ imported: Resource[]; errors: string[] }> {
  const imported: Resource[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const result = await importFile(file, options);
    if (result.ok && result.resource) imported.push(result.resource);
    else if (result.error) errors.push(result.error);
  }
  return { imported, errors };
}

/* ------------------------------------------------------------------ */
/* Attach / detach                                                     */
/* ------------------------------------------------------------------ */

function applyTarget(resource: Resource, target: AttachTarget): void {
  if (target.taskId) resource.taskIds = [target.taskId];
  if (target.blockId) resource.blockIds = [target.blockId];
  if (target.goalId) resource.goalIds = [target.goalId];
}

type LinkField = 'taskIds' | 'blockIds' | 'goalIds';

const FIELD_BY_KIND: Record<'task' | 'block' | 'goal', LinkField> = {
  task: 'taskIds',
  block: 'blockIds',
  goal: 'goalIds',
};

export async function attachResource(
  resourceId: ID,
  kind: 'task' | 'block' | 'goal',
  ownerId: ID,
): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return;
  const field = FIELD_BY_KIND[kind];
  const next = new Set(resource[field] ?? []);
  next.add(ownerId);
  const patch: Partial<Resource> = { updatedAt: Date.now() };
  patch[field] = [...next];
  await db.resources.update(resourceId, patch);

  // Keep the task's own resourceIds mirror in step so task queries stay cheap.
  if (kind === 'task') {
    const task = await db.tasks.get(ownerId);
    if (task && !task.resourceIds.includes(resourceId)) {
      await db.tasks.update(ownerId, {
        resourceIds: [...task.resourceIds, resourceId],
        updatedAt: Date.now(),
      });
    }
  }
  if (kind === 'block') {
    await db.blocks.update(ownerId, { resourceId, updatedAt: Date.now() });
  }
}

export async function detachResource(
  resourceId: ID,
  kind: 'task' | 'block' | 'goal',
  ownerId: ID,
): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return;
  const field = FIELD_BY_KIND[kind];
  const next = (resource[field] ?? []).filter((id) => id !== ownerId);
  const patch: Partial<Resource> = { updatedAt: Date.now() };
  patch[field] = next;
  await db.resources.update(resourceId, patch);

  if (kind === 'task') {
    const task = await db.tasks.get(ownerId);
    if (task) {
      await db.tasks.update(ownerId, {
        resourceIds: task.resourceIds.filter((id) => id !== resourceId),
        updatedAt: Date.now(),
      });
    }
  }
  if (kind === 'block') {
    const block = await db.blocks.get(ownerId);
    if (block?.resourceId === resourceId) {
      await db.blocks.update(ownerId, { resourceId: null, updatedAt: Date.now() });
    }
  }
}

/** Every resource attached to one owner, via the multi-entry index. */
export async function getResourcesFor(
  kind: 'task' | 'block' | 'goal',
  ownerId: ID,
): Promise<Resource[]> {
  const field = FIELD_BY_KIND[kind];
  return db.resources.where(field).equals(ownerId).toArray();
}

/* ------------------------------------------------------------------ */
/* Open / rename / remove                                              */
/* ------------------------------------------------------------------ */

export interface OpenTarget {
  kind: 'url' | 'blob';
  href: string;
  /** Call when the consumer is done, to release an object URL. */
  release: () => void;
  name: string;
  mime: string | null;
}

/**
 * Produces something openable. For blobs this mints an object URL that the
 * CALLER must release — returning a `release` closure keeps that explicit
 * rather than leaking one URL per click.
 */
export async function openResource(resourceId: ID): Promise<OpenTarget | null> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return null;

  if (resource.attachmentId) {
    const attachment = await db.attachments.get(resource.attachmentId);
    if (attachment) {
      const href = URL.createObjectURL(attachment.blob);
      return {
        kind: 'blob',
        href,
        release: () => URL.revokeObjectURL(href),
        name: attachment.name,
        mime: attachment.mime,
      };
    }
  }

  if (resource.url) {
    return {
      kind: 'url',
      href: resource.url,
      release: () => {},
      name: resource.title,
      mime: null,
    };
  }
  return null;
}

/** Opens in a new tab (URLs) or a blob viewer tab (files). */
export async function openResourceInNewTab(resourceId: ID): Promise<boolean> {
  const target = await openResource(resourceId);
  if (!target) return false;
  const win = window.open(target.href, '_blank', 'noopener,noreferrer');
  if (target.kind === 'blob') {
    // Give the new tab time to take ownership before revoking.
    setTimeout(target.release, 60_000);
  }
  return Boolean(win);
}

/** Downloads a file resource back to disk under its original name. */
export async function downloadResource(resourceId: ID): Promise<boolean> {
  const target = await openResource(resourceId);
  if (!target || target.kind !== 'blob') return false;
  const a = document.createElement('a');
  a.href = target.href;
  a.download = target.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(target.release, 2000);
  return true;
}

export async function renameResource(resourceId: ID, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  await db.resources.update(resourceId, { title: trimmed, updatedAt: Date.now() });
}

export async function updateResource(resourceId: ID, patch: Partial<Resource>): Promise<void> {
  await db.resources.update(resourceId, { ...patch, updatedAt: Date.now() });
}

/** Removes the resource and its blob, and unlinks it from every owner. */
export async function deleteResource(resourceId: ID): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return;

  await db.transaction(
    'rw',
    [db.resources, db.attachments, db.tasks, db.blocks, db.annotations, db.viewerProgress],
    async () => {
      if (resource.attachmentId) await db.attachments.delete(resource.attachmentId);
      await db.annotations.where('resourceId').equals(resourceId).delete();
      await db.viewerProgress.where('resourceId').equals(resourceId).delete();
      for (const taskId of resource.taskIds ?? []) {
        const task = await db.tasks.get(taskId);
        if (task) {
          await db.tasks.update(taskId, {
            resourceIds: task.resourceIds.filter((id) => id !== resourceId),
            updatedAt: Date.now(),
          });
        }
      }
      for (const blockId of resource.blockIds ?? []) {
        const block = await db.blocks.get(blockId);
        if (block?.resourceId === resourceId) {
          await db.blocks.update(blockId, { resourceId: null, updatedAt: Date.now() });
        }
      }
      await db.resources.delete(resourceId);
    },
  );
}

export async function archiveResource(resourceId: ID, archived: boolean): Promise<void> {
  await db.resources.update(resourceId, { archived, updatedAt: Date.now() });
}

/** Records reading/watching progress as a real Activity row. */
export async function recordProgress(resourceId: ID, currentUnit: number): Promise<void> {
  const resource = await db.resources.get(resourceId);
  if (!resource) return;
  const next = Math.max(0, Math.round(currentUnit));
  const delta = next - resource.currentUnit;
  await db.resources.update(resourceId, { currentUnit: next, updatedAt: Date.now() });
  if (delta !== 0) {
    await logActivity({
      type: 'resource_progress',
      title: resource.title,
      trackerId: resource.trackerId,
      resourceId,
      value: delta,
      unit: resource.unit,
      meta: { from: resource.currentUnit, to: next, total: resource.totalUnits },
    });
  }
}

/** Total bytes held by imported files — shown in Settings > data. */
export async function attachmentBytes(): Promise<number> {
  let total = 0;
  await db.attachments.each((a) => { total += a.size; });
  return total;
}
