/**
 * Storage module public surface.
 *
 * LifeOS persists to JSON files through a pluggable adapter. The rest of the
 * app only ever needs `storage`, `bootStorage` and `useStorageState`.
 */
export type {
  AdapterCapabilities, AdapterId, StorageAdapter, StorageEnvelope, StorageManifest,
} from './types';
export { BUNDLE_FILENAME, MANIFEST_NAME } from './types';
export {
  makeEnvelope, makeManifest, parseEnvelope, parseManifest, serializeEnvelope, APP_VERSION,
} from './envelope';
export { DirtyTracker } from './dirtyTracker';
export { detectAdapter, readEnvironment } from './detect';
export type { DetectionEnvironment, DetectionResult } from './detect';
export { collectionsToBundle, bundleToEnvelopes, readCollectionsFromDb, FILE_COLLECTIONS } from './bundle';
export { StorageRepository, storage } from './repository';
export type { StorageState, StorageStatus } from './repository';
export { bootStorage, useStorageState, installUnsavedGuard } from './boot';

export { MemoryAdapter } from './adapters/memoryAdapter';
export { IndexedDbAdapter } from './adapters/indexedDbAdapter';
export { HttpFileAdapter } from './adapters/httpFileAdapter';
export { FileSystemAccessAdapter, hasStoredFolderHandle } from './adapters/fileSystemAccessAdapter';
export {
  canShareFiles, DownloadUploadAdapter, requestPersistentStorage, saveTextAsFile,
} from './adapters/downloadUploadAdapter';
export type { SaveOutcome } from './adapters/downloadUploadAdapter';
export { SingleFileAdapter } from './adapters/singleFileAdapter';
export type {
  BoundTargetInfo, BoundTargetStatus, FsBoundFileHandle, SaveFilePicker,
} from './adapters/singleFileAdapter';
