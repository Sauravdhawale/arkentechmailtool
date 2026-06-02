import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createBulkJob } from "../api";
import { formatNumber } from "../lib/format";
import { isSupportedUpload, previewEmailFile } from "../lib/filePreview";
import type { UploadPreview } from "../types";

export function VerifyList() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const applyFile = async (nextFile: File | undefined) => {
    setError("");
    setPreview(null);
    setFile(null);

    if (!nextFile) {
      return;
    }

    if (!isSupportedUpload(nextFile)) {
      setError("Only CSV and XLSX files are supported.");
      return;
    }

    try {
      const nextPreview = await previewEmailFile(nextFile);
      setFile(nextFile);
      setPreview(nextPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "File validation failed.");
    }
  };

  const startVerification = async () => {
    if (!file) {
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await createBulkJob(file);
      navigate(`/jobs/${response.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create verification job.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-ink">Verify List</h1>
        <p className="mt-1 text-sm text-slate-500">CSV or XLSX with one column: emails</p>
      </div>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <button
          type="button"
          className="focus-ring min-h-80 rounded-lg border-2 border-dashed border-line bg-white p-8 text-left shadow-soft transition hover:border-emerald-400"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void applyFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-md ${
                dragging ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              <UploadCloud size={28} aria-hidden />
            </div>
            <div className="mt-5 text-lg font-semibold">Drop CSV/XLSX upload</div>
            <div className="mt-2 max-w-md text-sm text-slate-500">
              Required header: emails
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(event) => void applyFile(event.target.files?.[0])}
          />
        </button>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center gap-3 border-b border-line pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
              <FileSpreadsheet size={20} aria-hidden />
            </div>
            <div>
              <div className="text-sm font-semibold">Upload Summary</div>
              <div className="text-xs text-slate-500">{preview?.fileName ?? "No file selected"}</div>
            </div>
          </div>

          <dl className="mt-5 space-y-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">File name</dt>
              <dd className="max-w-48 truncate font-medium">{preview?.fileName ?? "-"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Total records</dt>
              <dd className="font-medium">{formatNumber(preview?.totalRecords ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Duplicate emails</dt>
              <dd className="font-medium">{formatNumber(preview?.duplicateEmails ?? 0)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Unique emails to verify</dt>
              <dd className="font-medium">
                {formatNumber(preview?.uniqueEmailsToVerify ?? 0)}
              </dd>
            </div>
          </dl>

          {error && (
            <div className="mt-5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={!file || loading}
            onClick={() => void startVerification()}
            className="focus-ring mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <UploadCloud size={17} aria-hidden />
            {loading ? "Starting..." : "Start Verification"}
          </button>
        </div>
      </section>
    </div>
  );
}
