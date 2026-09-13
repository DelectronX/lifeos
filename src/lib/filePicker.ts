import { isNativePlatform } from './nativeBridge';

/**
 * Opens the native file picker (via @capawesome/capacitor-file-picker) on
 * Capacitor platforms, or resolves to `null` on the web so callers fall back
 * to a plain `<input type="file">` — the same branch pattern as the rest of
 * `nativeBridge.ts`. Either path converges on plain web `File` objects so the
 * existing `importFiles()` / attachment pipeline never has to know which one
 * ran.
 *
 * Returns `null` (never throws) if the platform is not native, the plugin is
 * unavailable, or the user cancels — callers treat all three as "no files".
 */
export async function pickNativeFiles(): Promise<File[] | null> {
  if (!isNativePlatform()) return null;
  try {
    const { FilePicker } = await import('@capawesome/capacitor-file-picker');
    const result = await FilePicker.pickFiles({
      types: [
        'application/pdf', 'image/*', 'video/*', 'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      readData: true,
      limit: 0,
    });
    if (!result.files.length) return [];
    const files: File[] = [];
    for (const f of result.files) {
      const blob = f.blob ?? (f.data ? base64ToBlob(f.data, f.mimeType) : null);
      if (!blob) continue;
      files.push(new File([blob], f.name, { type: f.mimeType, lastModified: f.modifiedAt ?? Date.now() }));
    }
    return files;
  } catch (e) {
    // A thrown error here is almost always "user cancelled the picker" on
    // Android/iOS (the plugin rejects rather than resolving empty) — treat it
    // the same as an empty selection rather than surfacing a scary toast for
    // ordinary cancellation. Anything else still bubbles up as `[]`, and the
    // caller shows nothing broke; genuine plugin-missing errors are logged.
    console.warn('Native file picker unavailable or cancelled:', e);
    return [];
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
