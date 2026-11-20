const SECRET_BASENAME = [/^\.env(\..*)?$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, /\.(pem|key|p12|pfx|jks|keystore)$/i, /^credentials(\.json)?$/i, /^\.npmrc$/i, /^\.pypirc$/i, /^secrets?\.(json|ya?ml|toml)$/i];
const LOW_VALUE = [/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|uv\.lock|Cargo\.lock)$/, /\.min\.(js|css)$/, /(^|\/)(node_modules|dist|build|out|vendor|__pycache__|\.venv|venv|\.git)\//, /\.(map|snap|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|pdf|zip|gz|wasm|pyc)$/];

export function isSecretPath(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  return SECRET_BASENAME.some((r) => r.test(base)) || /(^|\/)\.ssh\//.test(rel);
}
export function lowValueReason(rel: string): string | null {
  if (/lock/i.test(rel.split("/").pop() ?? "") && /\.lock$|lock\.json$|lock\.ya?ml$/.test(rel)) return "lockfile";
  if (/\.min\.(js|css)$/.test(rel)) return "minified";
  if (/(^|\/)(node_modules|dist|build|out|vendor|__pycache__|\.venv|venv)\//.test(rel)) return "generated/vendored";
  if (/\.(map|snap|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|pdf|zip|gz|wasm|pyc)$/.test(rel)) return "binary/asset";
  return null;
}
export function isLowValue(rel: string): boolean {
  return lowValueReason(rel) !== null || LOW_VALUE.some((r) => r.test(rel));
}
export function langOf(rel: string): "python" | "typescript" | "tsx" | "javascript" | null {
  if (/\.pyi?$/.test(rel)) return "python";
  if (/\.tsx$/.test(rel)) return "tsx";
  if (/\.(ts|mts|cts)$/.test(rel)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(rel)) return "javascript";
  return null;
}
export function isTestPath(rel: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)\//.test(rel) || /(^|\/)test_[^/]+\.py$/.test(rel) || /[._-](test|spec)\.[cm]?[jt]sx?$/.test(rel) || /_test\.py$/.test(rel);
}
export function stem(rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  return base.replace(/\.[^.]+$/, "");
}
export function estimateTokens(text: string): number {
  return Math.ceil((text.length / 4) * 1.1);
}
