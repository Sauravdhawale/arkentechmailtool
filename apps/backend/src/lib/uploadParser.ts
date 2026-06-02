import { EMAIL_COLUMN_NAME } from "@arken/shared";
import { parse as parseCsv } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";

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

async function parseXlsxRows(buffer: Buffer): Promise<unknown[][]> {
  const rows = await readXlsxFile(buffer);
  return rows.filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0));
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
