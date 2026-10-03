"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  MfaSetup,
  type MfaSetupHeading,
} from "../../(app)/configuracion/mfa-setup";

const PageHeading: MfaSetupHeading = ({ title, description }) => (
  <div className="space-y-1.5">
    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    <p className="text-muted-foreground">{description}</p>
  </div>
);

export function RequiredMfaSetup({ next }: { next: string }) {
  const router = useRouter();
  return (
    <div className="space-y-6">
      <MfaSetup
        Heading={PageHeading}
        onDone={() => {
          toast.success("Verificación en dos pasos activada.");
          router.replace(next);
        }}
      />
    </div>
  );
}
