export type EmailStatus =
  | "valid"
  | "invalid"
  | "risky"
  | "unknown"
  | "duplicate";

export type JobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type DashboardStats = {
  totalVerified: number;
  validEmails: number;
  invalidEmails: number;
  riskyEmails: number;
  unknownEmails: number;
  disposableEmails: number;
  duplicateEmails: number;
};

export type BulkJob = {
  id: string;
  fileName: string;
  status: JobStatus;
  totalEmails: number;
  uniqueEmails: number;
  duplicateEmails: number;
  processedEmails: number;
  validCount: number;
  invalidCount: number;
  riskyCount: number;
  unknownCount: number;
  disposableCount: number;
  acceptAllCount: number;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmailResult = {
  id: string;
  email: string;
  normalizedEmail: string;
  domain: string | null;
  status: EmailStatus;
  reason: string | null;
  reacherIsReachable: string | null;
  isDuplicate: boolean;
  duplicateOf: string | null;
  isDisposable: boolean;
  isAcceptAll: boolean;
  mxFound: boolean | null;
  smtpResult: string | null;
  errorMessage: string | null;
  checkedAt: string | null;
  createdAt: string;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

export type JobDetailsResponse = {
  job: BulkJob;
  chart: Array<{ status: string; count: number }>;
};

export type UploadPreview = {
  fileName: string;
  totalRecords: number;
  duplicateEmails: number;
  uniqueEmailsToVerify: number;
};

export type ManualVerificationResponse = {
  result: EmailResult;
};
