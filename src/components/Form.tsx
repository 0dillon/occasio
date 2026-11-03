"use client";
import { createContext, useActionState, useContext, useId, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/server/action";

const Ctx = createContext<FormState>({});
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Progressive form: works without JS (server action), shows errors/success inline. */
export function ActionForm({ action, children, className, encType, id, resetOnSuccess }: {
  action: Action; children: ReactNode; className?: string; encType?: "multipart/form-data"; id?: string; resetOnSuccess?: boolean;
}) {
  const [state, run] = useActionState(action, {});
  return (
    <Ctx.Provider value={state}>
      <form action={run} className={className ?? "stack"} encType={encType} id={id} noValidate key={resetOnSuccess && state.ok ? JSON.stringify(state) : undefined}>
        {state.error ? (
          <div className="alert error" role="alert">{state.error}</div>
        ) : state.ok && state.message ? (
          <div className="alert success" role="status">{state.message}</div>
        ) : null}
        {children}
      </form>
    </Ctx.Provider>
  );
}

export const useFormResult = () => useContext(Ctx);

export function Field({ name, label, hint, type = "text", defaultValue, required, textarea, autoComplete, placeholder, inputMode, maxLength, min, max, children, inputId }: {
  name: string; label: string; hint?: ReactNode; type?: string; defaultValue?: string | number | null; required?: boolean; textarea?: boolean;
  autoComplete?: string; placeholder?: string; inputMode?: "url" | "email" | "text" | "numeric"; maxLength?: number; min?: string; max?: string; children?: ReactNode; inputId?: string;
}) {
  const s = useContext(Ctx);
  const id = useId();
  const err = s.fields?.[name];
  const value = s.values?.[name] ?? (defaultValue ?? undefined);
  const common = {
    id, name, required, "aria-invalid": err ? true : undefined,
    "aria-describedby": [hint ? `${id}-h` : "", err ? `${id}-e` : ""].filter(Boolean).join(" ") || undefined,
    defaultValue: value === null ? undefined : (value as string | undefined), placeholder, maxLength,
  };
  return (
    <div className="field">
      <label htmlFor={inputId ?? id}>{label}{required ? null : <span className="muted" style={{ fontWeight: 500 }}> (optional)</span>}</label>
      {hint ? <span className="hint" id={`${id}-h`}>{hint}</span> : null}
      {children ?? (textarea
        ? <textarea className="textarea" {...common} />
        : <input className="input" type={type} autoComplete={autoComplete} inputMode={inputMode} min={min} max={max} {...common} />)}
      {err ? <span className="err" id={`${id}-e`}>{err}</span> : null}
    </div>
  );
}

export function Submit({ children, className = "btn primary", pending = "Working…", name, value, formNoValidate }: {
  children: ReactNode; className?: string; pending?: string; name?: string; value?: string; formNoValidate?: boolean;
}) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={busy} aria-disabled={busy} name={name} value={value} formNoValidate={formNoValidate}>
      {busy ? pending : children}
    </button>
  );
}
