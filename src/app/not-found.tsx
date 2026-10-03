import Link from "next/link";

import { PageContainer } from "@/components";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer>
      <div className="flex flex-col items-center py-20 text-center">
        <p className="text-sm font-medium text-primary">Error 404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          No encontramos esta página
        </h1>
        <p className="mt-2 max-w-sm text-muted-foreground">
          Puede que el enlace esté incompleto o que la página ya no exista.
        </p>
        <Button asChild className="mt-6">
          <Link href="/inventario">Ir a Inventario</Link>
        </Button>
      </div>
    </PageContainer>
  );
}
