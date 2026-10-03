"use client";

import { Laptop, Loader2, LogOut, Smartphone } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { AnimatePresence, motion, transitions } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDateTime, formatRelative } from "@/lib";

import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";

export type SessionRow = {
  id: string;
  current: boolean;
  label: string;
  mobile: boolean;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
};

export function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  const [rows, removeRows] = useOptimistic(sessions, (current, ids: string[]) =>
    current.filter((s) => !ids.includes(s.id)),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const others = rows.filter((s) => !s.current);

  function revoke(id: string) {
    setPendingId(id);
    startTransition(async () => {
      removeRows([id]);
      const result = await revokeSessionAction(id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setPendingId(null);
    });
  }

  function revokeOthers() {
    setConfirmOpen(false);
    startTransition(async () => {
      removeRows(others.map((s) => s.id));
      const result = await revokeOtherSessionsAction();
      toast.success(result.message);
    });
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h3 className="font-medium">Sesiones activas</h3>
          <p className="text-sm text-muted-foreground">
            Dispositivos donde tu cuenta está abierta. Si no reconoces alguno,
            ciérralo.
          </p>
        </div>
        {others.length > 0 && (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={isPending}>
                <LogOut aria-hidden="true" data-icon="inline-start" />
                Cerrar las demás
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>¿Cerrar las demás sesiones?</DialogTitle>
                <DialogDescription>
                  Se cerrará tu cuenta en {others.length}{" "}
                  {others.length === 1 ? "dispositivo" : "dispositivos"}. Esta
                  sesión seguirá abierta.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancelar</Button>
                </DialogClose>
                <Button variant="destructive" onClick={revokeOthers}>
                  Cerrar sesiones
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <ul className="divide-y">
        <AnimatePresence initial={false}>
          {rows.map((s) => {
            const Icon = s.mobile ? Smartphone : Laptop;
            return (
              <motion.li
                key={s.id}
                layout
                exit={{ opacity: 0, x: 24, transition: transitions.exit }}
                className="flex items-center gap-3 p-4 sm:px-5"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {s.label}
                    {s.current && <Badge variant="success">Esta sesión</Badge>}
                  </p>
                  <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    <span
                      // Server and browser may compute "hace X" seconds apart.
                      suppressHydrationWarning
                      title={formatDateTime(new Date(s.lastActiveAt))}
                    >
                      Activa{" "}
                      {formatRelative(new Date(s.lastActiveAt)).toLowerCase()}
                    </span>
                    {s.ipAddress && <> · IP {s.ipAddress}</>}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    variant="ghost"
                    onClick={() => revoke(s.id)}
                    disabled={isPending}
                    aria-label={`Cerrar sesión en ${s.label}`}
                  >
                    {pendingId === s.id ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <LogOut aria-hidden="true" />
                    )}
                    <span className="hidden sm:inline">Cerrar</span>
                  </Button>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
