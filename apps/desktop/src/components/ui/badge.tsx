import * as React from "react";
import { cn } from "../../lib/utils.ts";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-200",
        className,
      )}
      {...props}
    />
  );
}
