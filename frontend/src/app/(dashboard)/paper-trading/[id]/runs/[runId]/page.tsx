"use client";

import { useParams } from "next/navigation";
import RunReport from "@/components/reports/run-report";

export default function PaperRunReportPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const runId = params.runId as string;

  return (
    <RunReport
      sessionId={sessionId}
      runId={runId}
      backPath={`/paper-trading/${sessionId}`}
    />
  );
}
