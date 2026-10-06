/** Scheme do app Expo (`app.json`). Não é um segredo. */
export const MOBILE_APP_SCHEME = "nexusscience";

const DEV_METRO_PORTS = new Set(["8081", "8082", "19000", "19006"]);

/**
 * Origens que o better-auth aceita além do `CORS_ORIGIN` do frontend web.
 * `exp://` só em development — no plugin e aqui. Produção fica no scheme do app.
 */
export function mobileTrustedOrigins(nodeEnv: string): string[] {
  const origins = [`${MOBILE_APP_SCHEME}://`, `${MOBILE_APP_SCHEME}://*`];
  if (nodeEnv === "development") {
    origins.push(
      "exp://",
      "exp://**",
      "exp://192.168.*.*:*/**",
      "exp://10.*.*.*:*/**",
      "exp://127.0.0.1:*/**",
    );
  }
  return origins;
}

function isPrivateDevHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

/**
 * CORS do Fastify não entende os wildcards do better-auth. Sem `Origin`
 * (app nativo, curl) deixa passar — isso não é `*`. Browser cross-site
 * continua limitado à lista.
 */
export function isAllowedCorsOrigin(
  origin: string | undefined,
  configured: readonly string[],
  nodeEnv: string,
): boolean {
  if (!origin) return true;
  if (configured.includes(origin)) return true;
  if (origin === `${MOBILE_APP_SCHEME}://` || origin.startsWith(`${MOBILE_APP_SCHEME}://`)) {
    return true;
  }
  if (nodeEnv !== "development") return false;
  if (origin.startsWith("exp://") || origin.startsWith("exps://")) return true;

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!DEV_METRO_PORTS.has(url.port)) return false;
    return isPrivateDevHost(url.hostname);
  } catch {
    return false;
  }
}
