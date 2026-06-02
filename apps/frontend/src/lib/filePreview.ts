import Papa from "papaparse";
import readXlsxFile from "read-excel-file";
import type { UploadPreview } from "../types";

const REQUIRED_COLUMN = "emails";

async function parseCsvRows(file: File): Promise<unknown[][]> {
  const text = await file.text();
  const parsed = Papa.parse<unknown[]>(text, {
    skipEmptyLines: true
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0].message);
  }

  return parsed.data;
}

async function parseXlsxRows(file: File): Promise<unknown[][]> {
  const rows = await readXlsxFile(file);
  return rows.filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0));
}

async function parseRows(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name)) {
    return parseCsvRows(file);
  }
  return parseXlsxRows(file);
}

export async function previewEmailFile(file: File): Promise<UploadPreview> {
  const rows = await parseRows(file);

  if (rows.length === 0) {
    throw new Error('File must contain exactly one column named "emails".');
  }

  const header = rows[0];
  if (header.length !== 1 || String(header[0]).replace(/^\uFEFF/, "") !== REQUIRED_COLUMN) {
    throw new Error('File must contain exactly one column named "emails".');
  }

  const emails: string[] = [];
  rows.slice(1).forEach((row, index) => {
    const meaningfulCells = row.filter((cell) => String(cell ?? "").trim().length > 0);
    if (row.length > 1 || meaningfulCells.length > 1) {
      throw new Error("Extra columns are not allowed.");
    }

    const email = String(row[0] ?? "").trim();
    if (!email) {
      throw new Error(`Row ${index + 2} has an empty emails value.`);
    }
    emails.push(email);
  });

  if (emails.length === 0) {
    throw new Error("File must include at least one email.");
  }

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
