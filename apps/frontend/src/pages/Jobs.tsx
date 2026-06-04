import { Download, ListChecks } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { downloadJobResults, getJobs } from "../api";
import { EmptyState } from "../components/EmptyState";
import { ProgressBar } from "../components/ProgressBar";
import { StatusBadge } from "../components/StatusBadge";
import { formatDate } from "../lib/format";
import type { BulkJob, JobStatus } from "../types";

const tabs: Array<JobStatus | "all"> = [
  "all",
  "queued",
  "processing",
  "completed",
  "failed"
];

export function Jobs() {
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getJobs(status)
      .then((response) => setJobs(response.items))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load lists.");
      });
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-ink">Lists</h1>
          <p className="mt-1 text-sm text-slate-500">Bulk verification jobs</p>
        </div>
        <Link
          to="/verify-list"
          className="focus-ring inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
        >
          <ListChecks size={17} aria-hidden />
          New List
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setStatus(tab)}
            className={`focus-ring rounded-md px-3 py-2 text-sm font-semibold capitalize ${
              status === tab
                ? "bg-emerald-600 text-white"
                : "border border-line bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-line bg-white shadow-soft">
        {jobs.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ListChecks} title="No lists found" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] divide-y divide-line text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">File name</th>
                  <th className="px-4 py-3 font-semibold">Job ID</th>
                  <th className="px-4 py-3 font-semibold">Upload date</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Total emails</th>
                  <th className="px-4 py-3 font-semibold">Processed emails</th>
                  <th className="px-4 py-3 font-semibold">Valid</th>
                  <th className="px-4 py-3 font-semibold">Invalid</th>
                  <th className="px-4 py-3 font-semibold">Risky / accept-all</th>
                  <th className="px-4 py-3 font-semibold">Unknown</th>
                  <th className="px-4 py-3 font-semibold">Disposable</th>
                  <th className="px-4 py-3 font-semibold">Duplicate</th>
                  <th className="px-4 py-3 font-semibold">Progress</th>
                  <th className="px-4 py-3 font-semibold">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/jobs/${job.id}`} className="hover:text-emerald-700">
                        {job.fileName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{job.id}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(job.createdAt)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3">{job.totalEmails}</td>
                    <td className="px-4 py-3">{job.processedEmails}</td>
                    <td className="px-4 py-3">{job.validCount}</td>
                    <td className="px-4 py-3">{job.invalidCount}</td>
                    <td className="px-4 py-3">{job.riskyCount}</td>
                    <td className="px-4 py-3">{job.unknownCount}</td>
                    <td className="px-4 py-3">{job.disposableCount}</td>
                    <td className="px-4 py-3">{job.duplicateEmails}</td>
                    <td className="px-4 py-3">
                      <div className="w-36">
                        <ProgressBar value={job.progress} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="focus-ring rounded-md p-2 text-slate-600 hover:bg-slate-100"
                          aria-label={`Download ${job.fileName}`}
                          onClick={() => void downloadJobResults(job.id, "all")}
                        >
                          <Download size={17} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
