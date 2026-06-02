import { MailCheck, SearchCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { verifySingleEmail } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { formatDate } from "../lib/format";
import type { EmailResult } from "../types";

export function ManualVerify() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<EmailResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await verifySingleEmail(email);
      setResult(response.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-ink">Manual Verify</h1>
        <p className="mt-1 text-sm text-slate-500">Single email verification</p>
      </div>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            className="focus-ring min-h-11 flex-1 rounded-md border border-line px-3 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <SearchCheck size={17} aria-hidden />
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}
      </section>

      {result && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <MailCheck size={20} aria-hidden />
              </div>
              <div>
                <div className="font-semibold">{result.email}</div>
                <div className="text-xs text-slate-500">{result.domain ?? "-"}</div>
              </div>
            </div>
            <StatusBadge status={result.status} />
          </div>

          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Reason</dt>
              <dd className="mt-1 font-medium">{result.reason ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">MX found</dt>
              <dd className="mt-1 font-medium">
                {result.mxFound === null ? "-" : result.mxFound ? "Yes" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">SMTP result</dt>
              <dd className="mt-1 font-medium">{result.smtpResult ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Disposable</dt>
              <dd className="mt-1 font-medium">{result.isDisposable ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Checked at</dt>
              <dd className="mt-1 font-medium">{formatDate(result.checkedAt)}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
