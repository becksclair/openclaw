import * as React from "react";
import { cn } from "../../lib/utils.ts";

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function Switch({ checked, disabled, onCheckedChange }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
        checked ? "border-emerald-400 bg-emerald-400/80" : "border-white/10 bg-white/10",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
      disabled={disabled}
      role="switch"
      type="button"
      onClick={() => onCheckedChange(!checked)}
    >
      <span
        className={cn(
          "block h-4 w-4 rounded-full bg-slate-950 transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
