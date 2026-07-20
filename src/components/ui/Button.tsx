import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "ghost";
}

export function Button({ children, icon: Icon, variant = "secondary", ...props }: ButtonProps) {
  return (
    <button className={`button button-${variant}`} type="button" {...props}>
      {Icon ? <Icon aria-hidden="true" size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}
