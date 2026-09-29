const SECRET_ASSIGNMENT = /\b(api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|authorization|password|passwd|secret|token)\b\s*[:=]\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}/gi;
const PROVIDER_KEY = /\b(?:sk|hsk|gsk|gh[pousr]|xox[baprs]|glpat)[_-][A-Za-z0-9_-]{8,}\b/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IPV4 = /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g;
const IPV6 = /(?<![A-F0-9:])(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{0,4}(?![A-F0-9:])/gi;

/** Remove secrets and personal/network identifiers before any log leaves the server. */
export function redact(input: string): string {
  return input
    .replace(SECRET_ASSIGNMENT, '$1=[REDACTED_SECRET]')
    .replace(BEARER_TOKEN, 'Bearer [REDACTED_TOKEN]')
    .replace(PROVIDER_KEY, '[REDACTED_KEY]')
    .replace(EMAIL, '[REDACTED_EMAIL]')
    .replace(IPV4, '[REDACTED_IP]')
    .replace(IPV6, '[REDACTED_IP]');
}
