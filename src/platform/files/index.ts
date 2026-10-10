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
export { buildCsv, buildXlsx, neutralizeFormula } from "./spreadsheet";
export type { Cell, Sheet } from "./spreadsheet";
export { READ_LIMITS, readSpreadsheet } from "./spreadsheet-reader";
export type {
  ReadSpreadsheetResult,
  SpreadsheetContent,
} from "./spreadsheet-reader";
export {
  PDF_PAGE,
  PdfPageWriter,
  buildPdf,
  pdfText,
  textWidth,
  wrapText,
} from "./pdf";
export type { PdfFont, PdfTextOptions } from "./pdf";
