"use client";

import { useEffect } from "react";

import { ErrorState, PageContainer } from "@/components";
import { Button } from "@/components/ui/button";

export default function SectionError({
  error,
  retry,
}: {
  error: unknown;
  /** Asks the server again (reset() would only re-render what failed). */
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest =
    error instanceof Error && "digest" in error
      ? String((error as Error & { digest?: string }).digest ?? "")
      : "";

  return (
    <PageContainer>
      <ErrorState
        action={<Button onClick={() => retry()}>Reintentar</Button>}
        description={
          digest
            ? `Inténtalo de nuevo. Si continúa, comparte este código con soporte: ${digest}`
            : undefined
        }
      />
    </PageContainer>
  );
}
