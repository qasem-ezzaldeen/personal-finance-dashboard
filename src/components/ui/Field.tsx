import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[1rem] text-ink placeholder:text-ink-faint " +
  "transition focus:border-focus focus:outline-none focus:ring-3 focus:ring-brand disabled:bg-surface-muted disabled:text-ink-soft " +
  "aria-[invalid=true]:border-loss-ink";

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
  className?: string;
  labelAside?: ReactNode;
}

/** Label + control + hint/error, wired together for screen readers. */
export function Field({ label, hint, error, children, className, labelAside }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {labelAside}
      </div>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={hintId} className="text-sm text-loss-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, prefix, suffix, ...props }, ref) {
  if (!prefix && !suffix) return <input ref={ref} className={cn(control, "h-11", className)} {...props} />;
  return (
    <div className="relative flex items-center">
      {prefix ? (
        <span className="pointer-events-none absolute left-3.5 text-ink-soft" aria-hidden="true">
          {prefix}
        </span>
      ) : null}
      <input
        ref={ref}
        className={cn(control, "h-11", prefix ? "pl-12" : "", suffix ? "pr-16" : "", className)}
        {...props}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-3.5 text-sm text-ink-soft" aria-hidden="true">
          {suffix}
        </span>
      ) : null}
    </div>
  );
});

/** Numeric text input that brings up the decimal keypad on phones. */
export const AmountInput = forwardRef<HTMLInputElement, InputProps>(function AmountInput(props, ref) {
  return <Input ref={ref} type="text" inputMode="decimal" autoComplete="off" className="tabular" {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, "h-11 appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4.5 -translate-y-1/2 text-ink-soft"
        aria-hidden="true"
      />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "min-h-20 py-2.5", className)} {...props} />;
});

/** Parses user-typed amounts like "1,250.50" or "1250,5". Returns null for anything invalid. */
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, "");
  if (!trimmed) return null;
  let normalized = trimmed;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) normalized = trimmed.replace(/,/g, "");
  else if (/^\d+,\d+$/.test(trimmed)) normalized = trimmed.replace(",", ".");
  if (!/^-?\d*\.?\d+$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
