import clsx from 'clsx';
import { forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useId } from 'react';

export function Field({ label, error, hint, required, children, className }: { label: string; error?: string; hint?: string; required?: boolean; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-700">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children(id)}
      {error ? <p role="alert" className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

interface TI extends InputHTMLAttributes<HTMLInputElement> { label: string; error?: string; hint?: string; wrapperClassName?: string }
export const TextInput = forwardRef<HTMLInputElement, TI>(function TextInput({ label, error, hint, required, wrapperClassName, className, ...rest }, ref) {
  return <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>{(id) => <input id={id} ref={ref} required={false} aria-invalid={!!error} className={clsx('input', error && 'input-error', className)} {...rest} />}</Field>;
});

interface SI extends SelectHTMLAttributes<HTMLSelectElement> { label: string; error?: string; hint?: string; wrapperClassName?: string; options: { value: string | number; label: string; disabled?: boolean }[]; placeholder?: string }
export function SelectInput({ label, error, hint, required, options, placeholder, wrapperClassName, className, ...rest }: SI) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      {(id) => (
        <select id={id} aria-invalid={!!error} className={clsx('input', error && 'input-error', className)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

interface TA extends TextareaHTMLAttributes<HTMLTextAreaElement> { label: string; error?: string; hint?: string; wrapperClassName?: string }
export function TextArea({ label, error, hint, required, wrapperClassName, className, ...rest }: TA) {
  return <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>{(id) => <textarea id={id} rows={3} aria-invalid={!!error} className={clsx('input', error && 'input-error', className)} {...rest} />}</Field>;
}

/** Compact, label-less control used in filter bars. */
export function FilterSelect({ value, onChange, options, label, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; className?: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={clsx('input w-auto min-w-[9rem] py-2', className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
