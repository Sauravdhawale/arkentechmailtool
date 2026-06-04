import type {
  BulkJob,
  DashboardStats,
  EmailResult,
  JobDetailsResponse,
  JobStatus,
  ManualVerificationResponse,
  Paginated
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const API_ACCESS_TOKEN = import.meta.env.VITE_API_ACCESS_TOKEN ?? "";

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

type BulkJobUploadResponse = {
  jobId: string;
  status: string;
  fileName: string;
  totalRecords: number;
  duplicateEmails: number;
  uniqueEmailsToVerify: number;
};

function headersFor(body: unknown): HeadersInit {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (API_ACCESS_TOKEN) {
    headers["x-api-key"] = API_ACCESS_TOKEN;
  }
  return headers;
}

async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const body =
    options.body instanceof FormData
      ? options.body
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headersFor(options.body),
      ...options.headers
    },
    body
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getStats() {
  return apiFetch<DashboardStats>("/api/stats");
}

export function verifySingleEmail(email: string) {
  return apiFetch<ManualVerificationResponse>("/api/verify/single", {
    method: "POST",
    body: { email }
  });
}

export function createBulkJob(file: File, onUploadProgress?: (progress: number) => void) {
  const formData = new FormData();
  formData.append("file", file);

  return new Promise<BulkJobUploadResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_BASE_URL}/api/bulk/jobs`);

    if (API_ACCESS_TOKEN) {
      request.setRequestHeader("x-api-key", API_ACCESS_TOKEN);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onUploadProgress) {
        onUploadProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };

    request.onload = () => {
      let payload: BulkJobUploadResponse | { error?: string } = {};
      try {
        payload = JSON.parse(request.responseText || "{}") as
          | BulkJobUploadResponse
          | { error?: string };
      } catch {
        payload = {};
      }

      if (request.status >= 200 && request.status < 300) {
        onUploadProgress?.(100);
        resolve(payload as BulkJobUploadResponse);
        return;
      }

      reject(
        new Error(
          "error" in payload && payload.error
            ? payload.error
            : `Request failed with HTTP ${request.status}`
        )
      );
    };

    request.onerror = () => reject(new Error("Upload failed. Check your network connection."));
    request.send(formData);
  });
}

export function getJobs(status?: JobStatus | "all", page = 1, limit = 20) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit)
  });
  if (status && status !== "all") {
    params.set("status", status);
  }
  return apiFetch<Paginated<BulkJob>>(`/api/bulk/jobs?${params.toString()}`);
}

export function getJob(jobId: string) {
  return apiFetch<JobDetailsResponse>(`/api/bulk/jobs/${jobId}`);
}

export function getJobResults(
  jobId: string,
  status = "all",
  page = 1,
  limit = 50
) {
  const params = new URLSearchParams({
    status,
    page: String(page),
    limit: String(limit)
  });
  return apiFetch<Paginated<EmailResult>>(
    `/api/bulk/jobs/${jobId}/results?${params.toString()}`
  );
}

export async function downloadJobResults(jobId: string, filter: string) {
  const response = await fetch(
    `${API_BASE_URL}/api/bulk/jobs/${jobId}/download?filter=${filter}`,
    {
      headers: API_ACCESS_TOKEN ? { "x-api-key": API_ACCESS_TOKEN } : undefined
    }
  );

  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
