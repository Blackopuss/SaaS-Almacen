"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Input } from "./ui/input";

/** Password input with a show/hide toggle. Paste and managers are allowed. */
export function PasswordInput(
  props: Omit<React.ComponentProps<typeof Input>, "type">,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className="pr-12"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        aria-controls={props.id}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="size-4.5" />
        ) : (
          <Eye aria-hidden="true" className="size-4.5" />
        )}
      </button>
    </div>
  );
}
