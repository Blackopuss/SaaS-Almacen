// Public API of platform/files: private files of a company and their
// temporary download links (IMP-02).
export {
  FILE_LINK_SECONDS,
  FILE_PURPOSES,
  createFileLink,
  deleteFile,
  openFileLink,
  readStoredFile,
  storeFile,
} from "./files";
export type {
  FileActor,
  FileLinkResult,
  FilePurpose,
  OpenFileLinkResult,
  StoreFileResult,
  StoredFileContent,
} from "./files";
