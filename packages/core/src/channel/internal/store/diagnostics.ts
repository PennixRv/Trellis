/** Known credential syntax only; callers must keep arbitrary secrets out of diagnostics. */
export function redactDiagnostic<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
      .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, "[REDACTED]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/(["']?\b(?:password|secret|api[_-]?key|access[_-]?token|authorization)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, "$1[REDACTED]") as T;
  }
  if (Array.isArray(value)) return value.map((item) => redactDiagnostic(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /^(?:password|secret|api[_-]?key|access[_-]?token|authorization)$/i.test(key)
        ? "[REDACTED]" : redactDiagnostic(item),
    ])) as T;
  }
  return value;
}
