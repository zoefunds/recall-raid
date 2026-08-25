import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'tactical' | 'ghost' | 'plain';
type Size = 'sm' | 'md' | 'lg';

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary text-primary-on font-semibold hover:brightness-110 disabled:opacity-40',
  tactical: 'bg-secondary text-secondary-on font-semibold hover:brightness-110 disabled:opacity-40',
  ghost: 'border border-primary text-primary bg-transparent hover:bg-primary/10 disabled:opacity-40',
  plain: 'border border-border-subtle text-on-surface bg-surface-container hover:bg-surface-high disabled:opacity-40',
};

const sizeClasses: Record<Size, string> = {
  sm: 'text-[11px] px-3 py-1.5 gap-1.5',
  md: 'text-[13px] px-4 py-2 gap-2',
  lg: 'text-[14px] px-5 py-3 gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className = '', children, disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center rounded font-sans transition-colors ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...rest}
      >
        {loading && (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
