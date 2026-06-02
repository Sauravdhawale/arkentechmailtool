import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { JobDetails } from "./pages/JobDetails";
import { Jobs } from "./pages/Jobs";
import { ManualVerify } from "./pages/ManualVerify";
import { VerifyList } from "./pages/VerifyList";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="/verify-list" element={<VerifyList />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:jobId" element={<JobDetails />} />
        <Route path="/manual" element={<ManualVerify />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
