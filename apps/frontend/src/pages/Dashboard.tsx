import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  HelpCircle,
  Inbox,
  ListChecks,
  MailCheck
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getJobs, getStats } from "../api";
import { EmptyState } from "../components/EmptyState";
import { ProgressBar } from "../components/ProgressBar";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { formatDate } from "../lib/format";
import type { BulkJob, DashboardStats } from "../types";

const emptyStats: DashboardStats = {
  totalVerified: 0,
  validEmails: 0,
  invalidEmails: 0,
  riskyEmails: 0,
  unknownEmails: 0,
  disposableEmails: 0,
  duplicateEmails: 0
};

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getStats(), getJobs("all", 1, 5)])
      .then(([statsResponse, jobsResponse]) => {
        setStats(statsResponse);
        setJobs(jobsResponse.items);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load dashboard.");
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Email verification overview</p>
        </div>
        <Link
          to="/verify-list"
          className="focus-ring inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
        >
          <ListChecks size={17} aria-hidden />
          Verify List
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total verified"
          value={stats.totalVerified}
          icon={MailCheck}
          accent="bg-emerald-50 text-emerald-700"
        />
        <StatCard
          label="Valid emails"
          value={stats.validEmails}
          icon={CheckCircle2}
          accent="bg-teal-50 text-teal-700"
        />
        <StatCard
          label="Invalid emails"
          value={stats.invalidEmails}
          icon={AlertTriangle}
          accent="bg-rose-50 text-rose-700"
        />
        <StatCard
          label="Risky / accept-all"
          value={stats.riskyEmails}
          icon={HelpCircle}
          accent="bg-amber-50 text-amber-700"
        />
        <StatCard
          label="Unknown emails"
          value={stats.unknownEmails}
          icon={HelpCircle}
          accent="bg-sky-50 text-sky-700"
        />
        <StatCard
          label="Disposable emails"
          value={stats.disposableEmails}
          icon={Inbox}
          accent="bg-violet-50 text-violet-700"
        />
        <StatCard
          label="Duplicate emails"
          value={stats.duplicateEmails}
          icon={Copy}
          accent="bg-slate-100 text-slate-700"
        />
      </section>

      <section className="rounded-lg border border-line bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold tracking-normal">Recent Lists</h2>
          <Link to="/jobs" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">
            View all
          </Link>
        </div>
        {jobs.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ListChecks} title="No lists yet" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">File name</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Processed</th>
                  <th className="px-4 py-3 font-semibold">Progress</th>
                  <th className="px-4 py-3 font-semibold">Upload date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-4 py-3 font-medium text-ink">
                      <Link to={`/jobs/${job.id}`} className="hover:text-emerald-700">
                        {job.fileName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {job.processedEmails} / {job.totalEmails}
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-40">
                        <ProgressBar value={job.progress} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(job.createdAt)}</td>
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
