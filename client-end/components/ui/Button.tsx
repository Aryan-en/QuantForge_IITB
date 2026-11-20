"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium " +
    "transition-[background-color,color,border-color,transform] duration-[var(--forge-dur-fast)] ease-[var(--forge-ease)] " +
    "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent-hover",
        secondary: "border border-border bg-raised text-fg hover:bg-overlay",
        ghost: "text-muted hover:bg-raised hover:text-fg",
        danger: "border border-danger/60 bg-danger-soft text-fg hover:bg-danger/25",
        success: "border border-success/60 bg-success-soft text-fg hover:bg-success/25",
      },
      size: {
        sm: "h-6 px-2 text-secondary",
        md: "h-7 px-3 text-body",
        lg: "h-9 px-4 text-emph",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    icon?: LucideIcon;
    iconRight?: LucideIcon;
    loading?: boolean;
    /** Shown as tooltip and described-by when disabled, explaining why (Ui-regitry §B.7). */
    disabledReason?: string;
    children?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon: Icon, iconRight: IconRight, loading, disabled, disabledReason, className, children, onClick, title, ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;
  return (
    <button
      ref={ref}
      type="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      title={isDisabled && disabledReason ? disabledReason : title}
      onClick={isDisabled ? undefined : onClick}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : Icon ? <Icon size={iconSize} strokeWidth={1.75} aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} strokeWidth={1.75} aria-hidden /> : null}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonProps, "children" | "icon"> & { icon: LucideIcon; label: string; active?: boolean };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = "ghost", size = "md", className, active, ...rest },
  ref,
) {
  const px = size === "sm" ? 12 : size === "lg" ? 18 : 15;
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={rest.disabled && rest.disabledReason ? rest.disabledReason : label}
      className={cn(
        "px-0",
        size === "sm" ? "w-6" : size === "lg" ? "w-9" : "w-7",
        active && "bg-raised text-fg",
        className,
      )}
      {...rest}
    >
      <Icon size={px} strokeWidth={1.75} aria-hidden />
    </Button>
  );
});
