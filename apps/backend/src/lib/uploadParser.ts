import { EMAIL_COLUMN_NAME } from "@arken/shared";
import { parse as parseCsv } from "csv-parse/sync";
import { unzipSync, type Unzipped } from "fflate";
import type { Readable } from "node:stream";

const MAX_UPLOAD_ROWS = Number(process.env.UPLOAD_MAX_ROWS ?? 100_000);
const MAX_XLSX_XML_BYTES = Number(process.env.XLSX_MAX_XML_BYTES ?? 20 * 1024 * 1024);

export type ParsedEmailUpload = {
  emails: string[];
  totalRecords: number;
  duplicateEmails: number;
  uniqueEmailsToVerify: number;
};

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

function xmlDecode(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const isHex = entity.toLowerCase().startsWith("#x");
        const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
    }
  });
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = xmlDecode(match[2]);
  }
  return attrs;
}

function textFromXmlParts(xml: string, tagName: string): string {
  let value = "";
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, "g");
  for (const match of xml.matchAll(regex)) {
    value += xmlDecode(match[1]);
  }
  return value;
}

function columnFromCellRef(ref: string): string {
  return ref.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
}

function rowFromCellRef(ref: string): number {
  return Number(ref.match(/\d+/)?.[0] ?? 0);
}

function zipText(entries: Unzipped, path: string): string | undefined {
  const entry = entries[path];
  return entry ? Buffer.from(entry).toString("utf8") : undefined;
}

function unzipSelected(buffer: Buffer, wantedPaths: Set<string>): Unzipped {
  try {
    return unzipSync(new Uint8Array(buffer), {
      filter(file) {
        if (!wantedPaths.has(file.name)) {
          return false;
        }
        if (file.originalSize > MAX_XLSX_XML_BYTES) {
          throw new UploadValidationError(
            "XLSX worksheet is too large. Export the emails column to a fresh CSV file and try again."
          );
        }
        return true;
      }
    });
  } catch (error) {
    if (error instanceof UploadValidationError) {
      throw error;
    }
    throw new UploadValidationError("Unable to read XLSX file. Export it as CSV and try again.");
  }
}

function firstWorksheetPath(buffer: Buffer): string {
  const metadata = unzipSelected(
    buffer,
    new Set(["xl/workbook.xml", "xl/_rels/workbook.xml.rels"])
  );
  const workbookXml = zipText(metadata, "xl/workbook.xml");
  const relsXml = zipText(metadata, "xl/_rels/workbook.xml.rels");

  if (!workbookXml || !relsXml) {
    return "xl/worksheets/sheet1.xml";
  }

  const firstSheetTag = workbookXml.match(/<sheet\b[^>]*>/)?.[0];
  const firstSheetRelId = firstSheetTag ? parseAttributes(firstSheetTag)["r:id"] : undefined;

  if (!firstSheetRelId) {
    return "xl/worksheets/sheet1.xml";
  }

  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = parseAttributes(match[0]);
    if (attrs.Id !== firstSheetRelId || !attrs.Target) {
      continue;
    }

    const target = attrs.Target.replace(/\\/g, "/");
    if (target.startsWith("/")) {
      return target.slice(1);
    }
    return `xl/${target}`.replace(/\/[^/]+\/\.\.\//g, "/");
  }

  return "xl/worksheets/sheet1.xml";
}

function sharedStringsFromXml(xml: string | undefined): string[] {
  if (!xml) {
    return [];
  }

  const values: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    values.push(textFromXmlParts(match[1], "t"));
  }
  return values;
}

function assertStrictRows(rows: unknown[][]): string[] {
  if (rows.length === 0) {
    throw new UploadValidationError('File must contain exactly one column named "emails".');
  }

  const header = rows[0];
  if (header.length !== 1 || String(header[0]).replace(/^\uFEFF/, "") !== EMAIL_COLUMN_NAME) {
    throw new UploadValidationError('File must contain exactly one column named "emails".');
  }

  const emails: string[] = [];
  rows.slice(1).forEach((row, index) => {
    if (index + 1 > MAX_UPLOAD_ROWS) {
      throw new UploadValidationError(`Upload contains more than ${MAX_UPLOAD_ROWS} email rows.`);
    }

    const meaningfulCells = row.filter((value) => String(value ?? "").trim().length > 0);
    if (row.length > 1 || meaningfulCells.length > 1) {
      throw new UploadValidationError("Extra columns are not allowed. Use only the emails column.");
    }

    const email = String(row[0] ?? "").trim();
    if (!email) {
      throw new UploadValidationError(`Row ${index + 2} has an empty emails value.`);
    }
    emails.push(email);
  });

  if (emails.length === 0) {
    throw new UploadValidationError("File must include at least one email.");
  }

  return emails;
}

function summarize(emails: string[]): ParsedEmailUpload {
  const seen = new Set<string>();
  let duplicateEmails = 0;

  emails.forEach((email) => {
    const normalized = email.trim().toLowerCase();
    if (seen.has(normalized)) {
      duplicateEmails += 1;
      return;
    }
    seen.add(normalized);
  });

  return {
    emails,
    totalRecords: emails.length,
    duplicateEmails,
    uniqueEmailsToVerify: seen.size
  };
}

function parseCsvRows(buffer: Buffer): unknown[][] {
  return parseCsv(buffer.toString("utf8"), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true
  }) as unknown[][];
}

function cellValueFromXml(cellXml: string, attrs: Record<string, string>, sharedStrings: string[]) {
  if (attrs.t === "inlineStr") {
    return textFromXmlParts(cellXml, "t").trim();
  }

  const rawValue = textFromXmlParts(cellXml, "v").trim();
  if (!rawValue) {
    return "";
  }

  if (attrs.t === "s") {
    return sharedStrings[Number(rawValue)]?.trim() ?? "";
  }

  return rawValue;
}

function parseXlsxRows(buffer: Buffer): unknown[][] {
  const worksheetPath = firstWorksheetPath(buffer);
  const entries = unzipSelected(buffer, new Set([worksheetPath, "xl/sharedStrings.xml"]));
  const sheetXml = zipText(entries, worksheetPath);
  if (!sheetXml) {
    throw new UploadValidationError("Unable to read the first worksheet in the XLSX file.");
  }

  const sharedStrings = sharedStringsFromXml(zipText(entries, "xl/sharedStrings.xml"));
  const rows = new Map<number, string>();

  for (const match of sheetXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
    const attrs = parseAttributes(match[1] ?? match[3] ?? "");
    const ref = attrs.r ?? "";
    const rowNumber = rowFromCellRef(ref);
    const column = columnFromCellRef(ref);

    if (!rowNumber || !column) {
      continue;
    }
    if (rowNumber > MAX_UPLOAD_ROWS + 1) {
      throw new UploadValidationError(`Upload contains more than ${MAX_UPLOAD_ROWS} email rows.`);
    }

    const value = cellValueFromXml(match[2] ?? "", attrs, sharedStrings);
    if (!value) {
      continue;
    }
    if (column !== "A") {
      throw new UploadValidationError("Extra columns are not allowed. Use only the emails column.");
    }
    if (rows.has(rowNumber)) {
      throw new UploadValidationError("Extra columns are not allowed. Use only the emails column.");
    }
    rows.set(rowNumber, value);
  }

  if (rows.size === 0) {
    throw new UploadValidationError('File must contain exactly one column named "emails".');
  }

  const maxRow = Math.max(...rows.keys());
  const parsedRows: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    parsedRows.push([rows.get(rowNumber) ?? ""]);
  }
  return parsedRows;
}

export async function readUploadBuffer(
  stream: Readable,
  maxBytes: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      stream.destroy();
      throw new UploadValidationError(
        `Upload is too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))} MB.`
      );
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}

export async function parseEmailUpload(
  fileName: string,
  buffer: Buffer
): Promise<ParsedEmailUpload> {
  const lowerName = fileName.toLowerCase();
  const rows =
    lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")
      ? await parseXlsxRows(buffer)
      : lowerName.endsWith(".csv")
        ? parseCsvRows(buffer)
        : null;

  if (!rows) {
    throw new UploadValidationError("Only CSV and XLSX files are supported.");
  }

  return summarize(assertStrictRows(rows));
}
