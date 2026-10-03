"use client";

import { Package, PackagePlus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, FadeIn, LoadingState } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Fictitious sample data; never real inventory.
const products = [
  {
    sku: "TOR-001",
    name: "Tornillo hexagonal 1/4 × 1 in",
    qty: "200",
    unit: "pza",
    location: "A-01, B-03",
    state: "ok",
  },
  {
    sku: "CAB-001",
    name: "Cable THW calibre 12",
    qty: "197.25",
    unit: "m",
    location: "C-02",
    state: "low",
  },
  {
    sku: "CLA-001",
    name: "Clavo estándar 2 in",
    qty: "0",
    unit: "kg",
    location: "General",
    state: "out",
  },
] as const;

const stateBadge = {
  ok: <Badge variant="success">Disponible</Badge>,
  low: <Badge variant="warning">Existencia baja</Badge>,
  out: <Badge variant="destructive">Agotado</Badge>,
};

export function Showcase() {
  const [open, setOpen] = useState(false);
  const [boxes, setBoxes] = useState("3");
  const valid = /^\d+$/.test(boxes) && Number(boxes) > 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <FadeIn className="space-y-8">
        <header className="space-y-2">
          <p className="text-sm font-medium text-primary">Sistema visual</p>
          <h1 className="text-3xl font-semibold tracking-tight">Inventario</h1>
          <p className="max-w-prose text-muted-foreground">
            Vista previa de componentes con datos ficticios. Usa Tab para
            revisar el foco visible.
          </p>
        </header>

        <section className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="search">Buscar producto</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="search"
                placeholder="Nombre, SKU o código de barras"
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">Exportar</Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PackagePlus data-icon="inline-start" aria-hidden="true" />
                  Agregar entrada
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Agregar entrada</DialogTitle>
                  <DialogDescription>
                    Tornillo hexagonal 1/4 × 1 in · Caja = 100 piezas
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="boxes">Cajas recibidas</Label>
                  <Input
                    id="boxes"
                    inputMode="numeric"
                    value={boxes}
                    onChange={(e) => setBoxes(e.target.value)}
                    aria-invalid={!valid}
                    aria-describedby="boxes-help"
                  />
                  <p
                    id="boxes-help"
                    className={
                      valid
                        ? "text-sm text-muted-foreground tabular-nums"
                        : "text-sm text-destructive"
                    }
                  >
                    {valid
                      ? `${boxes} cajas × 100 = ${Number(boxes) * 100} piezas`
                      : "Escribe un número entero de cajas mayor que cero."}
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    disabled={!valid}
                    onClick={() => {
                      setOpen(false);
                      toast.success("Entrada registrada", {
                        description: `${Number(boxes) * 100} piezas en A-01 (ejemplo)`,
                      });
                    }}
                  >
                    Confirmar entrada
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </section>

        <section className="rounded-xl border bg-card">
          <Table>
            <TableCaption className="pb-4">Datos de ejemplo</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Existencia</TableHead>
                <TableHead>Ubicación</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.sku}>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.qty} {p.unit}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.location}
                  </TableCell>
                  <TableCell>{stateBadge[p.state]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section
          className="flex flex-wrap gap-2"
          aria-label="Variantes de botón"
        >
          <Button>Principal</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="outline">Contorno</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="destructive">Eliminar</Button>
          <Button variant="link">Enlace</Button>
          <Button disabled>Deshabilitado</Button>
        </section>
        <section aria-label="Estados" className="grid gap-6 lg:grid-cols-3">
          <EmptyState
            icon={Package}
            title="Todavía no hay productos"
            description="Agrega tu primer producto o importa tu Excel."
            action={<Button>Agregar producto</Button>}
          />
          <ErrorState action={<Button variant="outline">Reintentar</Button>} />
          <LoadingState rows={4} />
        </section>
      </FadeIn>
    </main>
  );
}
