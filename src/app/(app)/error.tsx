"use client";

import { useEffect } from "react";

import { ErrorState, PageContainer } from "@/components";
import { Button } from "@/components/ui/button";

export default function SectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer>
      <ErrorState
        action={<Button onClick={reset}>Reintentar</Button>}
        description={
          error.digest
            ? `Inténtalo de nuevo. Si continúa, comparte este código con soporte: ${error.digest}`
            : undefined
        }
      />
    </PageContainer>
  );
}
