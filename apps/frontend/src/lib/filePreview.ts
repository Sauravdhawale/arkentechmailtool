import { unzipSync, type Unzipped } from "fflate";
import Papa from "papaparse";
import type { UploadPreview } from "../types";

const REQUIRED_COLUMN = "emails";
const MAX_UPLOAD_ROWS = 100_000;
const MAX_XLSX_XML_BYTES = 256 * 1024 * 1024;

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

function unzipSelected(buffer: Uint8Array, wantedPaths: Set<string>): Unzipped {
  try {
    return unzipSync(buffer, {
      filter(file) {
        if (!wantedPaths.has(file.name)) {
          return false;
        }
        if (file.originalSize > MAX_XLSX_XML_BYTES) {
          throw new Error("XLSX worksheet is too large. Export the emails to CSV and try again.");
        }
        return true;
      }
    });
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unable to read XLSX file. Export it as CSV and try again.");
  }
}

function zipText(entries: Unzipped, path: string): string | undefined {
  const entry = entries[path];
  return entry ? new TextDecoder().decode(entry) : undefined;
}

function firstWorksheetPath(buffer: Uint8Array): string {
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

function columnFromCellRef(ref: string): string {
  return ref.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
}

function rowFromCellRef(ref: string): number {
  return Number(ref.match(/\d+/)?.[0] ?? 0);
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

function valuesWithoutOptionalHeader(values: string[]): string[] {
  const clean = values.map((value) => value.trim()).filter(Boolean);
  if (clean[0]?.replace(/^\uFEFF/, "").toLowerCase() === REQUIRED_COLUMN) {
    return clean.slice(1);
  }
  return clean;
}

function assertEmailValues(values: string[]): string[] {
  if (values.length === 0) {
    throw new Error("File must include at least one email.");
  }
  if (values.length > MAX_UPLOAD_ROWS) {
    throw new Error(`Upload contains more than ${MAX_UPLOAD_ROWS} email rows.`);
  }
  return values;
}

async function parseCsvEmails(file: File): Promise<string[]> {
  const text = await file.text();
  const parsed = Papa.parse<unknown[]>(text, {
    skipEmptyLines: true
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0].message);
  }

  const values = parsed.data.flat().map((cell) => String(cell ?? ""));
  return assertEmailValues(valuesWithoutOptionalHeader(values));
}

async function parseXlsxEmails(file: File): Promise<string[]> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const worksheetPath = firstWorksheetPath(buffer);
  const entries = unzipSelected(buffer, new Set([worksheetPath, "xl/sharedStrings.xml"]));
  const sheetXml = zipText(entries, worksheetPath);
  if (!sheetXml) {
    throw new Error("Unable to read the first worksheet in the XLSX file.");
  }

  const sharedStrings = sharedStringsFromXml(zipText(entries, "xl/sharedStrings.xml"));
  const cellsByRow = new Map<number, Map<string, string>>();

  for (const match of sheetXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g)) {
    const attrs = parseAttributes(match[1] ?? match[3] ?? "");
    const rowNumber = rowFromCellRef(attrs.r ?? "");
    const column = columnFromCellRef(attrs.r ?? "");
    if (!rowNumber || !column) {
      continue;
    }

    const value = cellValueFromXml(match[2] ?? "", attrs, sharedStrings);
    if (!value) {
      continue;
    }

    const row = cellsByRow.get(rowNumber) ?? new Map<string, string>();
    row.set(column, value);
    cellsByRow.set(rowNumber, row);
  }

  const populatedColumns = new Set<string>();
  for (const row of cellsByRow.values()) {
    for (const column of row.keys()) {
      populatedColumns.add(column);
    }
  }

  if (populatedColumns.size === 0) {
    throw new Error("File must include at least one email.");
  }
  if (populatedColumns.size > 1) {
    throw new Error("Extra columns are not allowed. Use only one email column.");
  }

  const emailColumn = [...populatedColumns][0];
  const values = [...cellsByRow.entries()]
    .sort(([rowA], [rowB]) => rowA - rowB)
    .map(([, row]) => row.get(emailColumn) ?? "");

  return assertEmailValues(valuesWithoutOptionalHeader(values));
}

async function parseEmails(file: File): Promise<string[]> {
  if (/\.csv$/i.test(file.name)) {
    return parseCsvEmails(file);
  }
  return parseXlsxEmails(file);
}

export async function previewEmailFile(file: File): Promise<UploadPreview> {
  const emails = await parseEmails(file);
  const seen = new Set<string>();
  let duplicateEmails = 0;

  emails.forEach((email) => {
    const normalized = email.toLowerCase();
    if (seen.has(normalized)) {
      duplicateEmails += 1;
      return;
    }
    seen.add(normalized);
  });

  return {
    fileName: file.name,
    totalRecords: emails.length,
    duplicateEmails,
    uniqueEmailsToVerify: seen.size
  };
}

export function isSupportedUpload(file: File): boolean {
  return /\.(csv|xlsx)$/i.test(file.name);
}
