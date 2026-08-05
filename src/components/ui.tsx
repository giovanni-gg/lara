import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Every screen is a single centred column — phone first, roomy on desktop. */
export function Screen({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-md px-4 pt-safe", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 pt-6 pb-5">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface p-4 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-11 text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS = {
  primary: "bg-accent text-accent-ink hover:brightness-105 active:brightness-95",
  secondary:
    "border border-line bg-raised text-foreground hover:border-accent/60",
  ghost: "text-muted hover:text-foreground",
  danger: "border border-again/40 text-again hover:bg-again/10",
} as const;

type Variant = keyof typeof VARIANTS;

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cn(BUTTON_BASE, VARIANTS[variant], className)}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link {...props} className={cn(BUTTON_BASE, VARIANTS[variant], className)} />
  );
}

export function Stat({
  value,
  label,
  tone = "default",
}: {
  value: ReactNode;
  label: string;
  tone?: "default" | "accent" | "good";
}) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-raised px-3 py-3 text-center">
      <div
        className={cn(
          "font-display text-2xl font-semibold leading-none tabular-nums",
          tone === "accent" && "text-accent",
          tone === "good" && "text-good",
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wide text-muted">
        {label}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      {icon ? <div className="mb-3 flex justify-center text-muted">{icon}</div> : null}
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">{body}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputStyles =
  "w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-base text-foreground placeholder:text-muted/70 outline-none focus:border-accent";

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
