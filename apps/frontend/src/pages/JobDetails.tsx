import { Download, ListChecks, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip
} from "recharts";
import { cancelJob, downloadJobResults, getJob, getJobResults } from "../api";
import { ProgressBar } from "../components/ProgressBar";
import { StatusBadge } from "../components/StatusBadge";
import { formatDate } from "../lib/format";
import type { EmailResult, JobDetailsResponse } from "../types";

const filterTabs = [
  "all",
  "valid",
  "invalid",
  "risky",
  "unknown",
  "disposable",
  "duplicates"
];

const chartColors: Record<string, string> = {
  valid: "#059669",
  invalid: "#e11d48",
  risky: "#d97706",
  unknown: "#0284c7",
  disposable: "#7c3aed",
  duplicates: "#64748b"
};

export function JobDetails() {
  const { jobId = "" } = useParams();
  const [details, setDetails] = useState<JobDetailsResponse | null>(null);
  const [results, setResults] = useState<EmailResult[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    if (!jobId) {
      return;
    }

    try {
      const [jobResponse, resultsResponse] = await Promise.all([
        getJob(jobId),
        getJobResults(jobId, filter, page, 50)
      ]);
      setDetails(jobResponse);
      setResults(resultsResponse.items);
      setTotalResults(resultsResponse.total);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load job.");
    }
  }, [filter, jobId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!details || !["queued", "processing"].includes(details.job.status)) {
      return undefined;
    }
    const interval = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(interval);
  }, [details, load]);

  const chartData = details?.chart.filter((item) => item.count > 0) ?? [];
  const hasNextPage = page * 50 < totalResults;
  const isCancellable =
    details?.job.status === "queued" || details?.job.status === "processing";

  const cancelCurrentJob = async () => {
    if (!jobId || !window.confirm("Cancel this verification job? Queued emails will stop processing.")) {
      return;
    }

    setCanceling(true);
    setError("");
    try {
      const response = await cancelJob(jobId);
      setDetails((current) =>
        current
          ? {
              ...current,
              job: response.job
            }
          : current
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cancel job.");
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Link to="/jobs" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">
            Lists
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-ink">
            {details?.job.fileName ?? "Job Details"}
          </h1>
          {details && (
            <p className="mt-1 font-mono text-xs text-slate-500">{details.job.id}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isCancellable && (
            <button
              type="button"
              disabled={canceling}
              onClick={() => void cancelCurrentJob()}
              className="focus-ring inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XCircle size={16} aria-hidden />
              {canceling ? "Cancelling..." : "Cancel Job"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={16} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {details && (
        <>
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Progress Summary</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {details.job.processedEmails} / {details.job.totalEmails}
                  </p>
                </div>
                <StatusBadge status={details.job.status} />
              </div>
              <div className="mt-5">
                <ProgressBar value={details.job.progress} />
              </div>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Total emails</dt>
                  <dd className="mt-1 font-semibold">{details.job.totalEmails}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Processed emails</dt>
                  <dd className="mt-1 font-semibold">{details.job.processedEmails}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Duplicate emails</dt>
                  <dd className="mt-1 font-semibold">{details.job.duplicateEmails}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Valid count</dt>
                  <dd className="mt-1 font-semibold">{details.job.validCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Invalid count</dt>
                  <dd className="mt-1 font-semibold">{details.job.invalidCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Risky / accept-all count</dt>
                  <dd className="mt-1 font-semibold">{details.job.riskyCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Unknown count</dt>
                  <dd className="mt-1 font-semibold">{details.job.unknownCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Disposable count</dt>
                  <dd className="mt-1 font-semibold">{details.job.disposableCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Upload date</dt>
                  <dd className="mt-1 font-semibold">{formatDate(details.job.createdAt)}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <h2 className="text-base font-semibold">Status Chart</h2>
              <div className="mt-3 h-72">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No chart data
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="count"
                        nameKey="status"
                        innerRadius={58}
                        outerRadius={92}
                        paddingAngle={2}
                      >
                        {chartData.map((item) => (
                          <Cell key={item.status} fill={chartColors[item.status] ?? "#334155"} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white shadow-soft">
            <div className="flex flex-col justify-between gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center">
              <div className="flex gap-2 overflow-x-auto">
                {filterTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    onClick={() => {
                      setFilter(tab);
                      setPage(1);
                    }}
                    className={`focus-ring rounded-md px-3 py-2 text-sm font-semibold capitalize ${
                      filter === tab
                        ? "bg-emerald-600 text-white"
                        : "border border-line bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "All results"],
                  ["valid", "Valid only"],
                  ["invalid", "Invalid only"],
                  ["unknown_risky", "Unknown/risky only"]
                ].map(([downloadFilter, label]) => (
                  <button
                    key={downloadFilter}
                    type="button"
                    onClick={() => void downloadJobResults(jobId, downloadFilter)}
                    className="focus-ring inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Download size={15} aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {results.length === 0 ? (
              <div className="p-4">
                <div className="rounded-lg border border-dashed border-line bg-white px-4 py-10 text-center text-sm font-medium text-slate-600">
                  No results found
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[980px] divide-y divide-line text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Email</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Reason</th>
                      <th className="px-4 py-3 font-semibold">Domain</th>
                      <th className="px-4 py-3 font-semibold">MX found</th>
                      <th className="px-4 py-3 font-semibold">SMTP result</th>
                      <th className="px-4 py-3 font-semibold">Disposable</th>
                      <th className="px-4 py-3 font-semibold">Checked at</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {results.map((result) => (
                      <tr key={result.id}>
                        <td className="px-4 py-3 font-medium text-ink">{result.email}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={result.status} />
                        </td>
                        <td className="max-w-72 px-4 py-3 text-slate-600">
                          {result.reason ?? result.errorMessage ?? "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{result.domain ?? "-"}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {result.mxFound === null ? "-" : result.mxFound ? "Yes" : "No"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{result.smtpResult ?? "-"}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {result.isDisposable ? "Yes" : "No"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDate(result.checkedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
              <span className="text-slate-500">
                Page {page} of {Math.max(1, Math.ceil(totalResults / 50))}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="focus-ring rounded-md border border-line bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!hasNextPage}
                  onClick={() => setPage((value) => value + 1)}
                  className="focus-ring rounded-md border border-line bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {!details && !error && (
        <div className="rounded-lg border border-line bg-white p-8 text-center">
          <ListChecks className="mx-auto text-slate-400" size={32} aria-hidden />
          <div className="mt-3 text-sm font-medium text-slate-600">Loading job</div>
        </div>
      )}
    </div>
  );
}
