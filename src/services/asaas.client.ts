import { randomUUID } from "node:crypto";

const USER_AGENT = "NexusScience/1.0";
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Client mínimo da API Asaas v3.
 *
 * Docs (2026-10): header `access_token` (não é Bearer), `User-Agent` obrigatório,
 * GET sem body. Paths relativos à base que já inclui `/v3`
 * (`https://api-sandbox.asaas.com/v3` ou o host antigo `sandbox.asaas.com/api/v3`).
 *
 * - POST /v3/customers — `name` + `cpfCnpj` no OpenAPI. Não há coluna de CPF
 *   em `students`, então o CPF não é enviado. Se a conta recusar, o checkout
 *   responde 502.
 * - GET /v3/customers?externalReference= — evita customer duplicado no retry.
 * - POST /v3/payments — `billingType: UNDEFINED` deixa o pagador escolher
 *   PIX, boleto ou cartão na fatura, se a conta tiver esses meios ligados.
 * - GET /v3/payments/{id} — recupera `invoiceUrl` quando a criação não devolve.
 */
export type AsaasCustomerInput = {
  name: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  externalReference: string;
};

export type AsaasPaymentInput = {
  customer: string;
  billingType: "UNDEFINED" | "BOLETO" | "CREDIT_CARD" | "PIX";
  value: number;
  dueDate: string;
  description?: string;
  externalReference: string;
};

export type AsaasCharge = {
  id: string;
  invoiceUrl: string | null;
};

export type AsaasClient = {
  findCustomerIdByExternalReference(externalReference: string): Promise<string | null>;
  createCustomer(input: AsaasCustomerInput): Promise<{ id: string }>;
  createPayment(input: AsaasPaymentInput): Promise<AsaasCharge>;
  getPayment(id: string): Promise<AsaasCharge>;
};

export class AsaasRequestError extends Error {
  readonly status: number;
  readonly correlationId: string;
  readonly codes: string[];
  readonly op: string;

  constructor(fields: { status: number; correlationId: string; codes: string[]; op: string }) {
    super("Falha ao comunicar com o Asaas");
    this.name = "AsaasRequestError";
    this.status = fields.status;
    this.correlationId = fields.correlationId;
    this.codes = fields.codes;
    this.op = fields.op;
  }
}

export function createAsaasClient(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): AsaasClient {
  const apiKey = options.apiKey.trim();
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  if (!apiKey) throw new Error("ASAAS_API_KEY ausente");
  if (!baseUrl) throw new Error("ASAAS_BASE_URL ausente");

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(method: "GET" | "POST", path: string, op: string, body?: unknown) {
    const correlationId = randomUUID();
    let response: Response;
    try {
      response = await fetchImpl(asaasUrl(baseUrl, path), {
        method,
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          access_token: apiKey,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AsaasRequestError({ status: 0, correlationId, codes: ["network"], op });
    }

    if (response.status >= 300 && response.status < 400) {
      throw new AsaasRequestError({
        status: response.status,
        correlationId,
        codes: ["redirect"],
        op,
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new AsaasRequestError({
        status: response.status,
        correlationId,
        codes: errorCodes(payload),
        op,
      });
    }
    return payload;
  }

  return {
    async findCustomerIdByExternalReference(externalReference) {
      const query = new URLSearchParams({ externalReference, limit: "1" });
      const payload = await request("GET", `customers?${query.toString()}`, "listCustomers");
      return customerIdFromList(payload, externalReference);
    },
    async createCustomer(input) {
      const payload = await request("POST", "customers", "createCustomer", input);
      return { id: requireId(payload, "createCustomer") };
    },
    async createPayment(input) {
      const payload = await request("POST", "payments", "createPayment", input);
      return chargeFromPayload(payload, "createPayment");
    },
    async getPayment(id) {
      const payload = await request("GET", `payments/${encodeURIComponent(id)}`, "getPayment");
      return chargeFromPayload(payload, "getPayment");
    },
  };
}

function asaasUrl(baseUrl: string, path: string): string {
  return `${baseUrl}/${path.replace(/^\/+/, "")}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorCodes(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || !("errors" in payload)) return [];
  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  const codes: string[] = [];
  for (const item of errors) {
    if (codes.length >= 5) break;
    if (!item || typeof item !== "object" || !("code" in item)) continue;
    const code = (item as { code?: unknown }).code;
    if (typeof code !== "string" || !code.trim()) continue;
    codes.push(code.trim().slice(0, 80));
  }
  return codes;
}

function customerIdFromList(payload: unknown, externalReference: string): string | null {
  if (!payload || typeof payload !== "object" || !("data" in payload)) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; externalReference?: unknown };
    if (row.externalReference !== externalReference) continue;
    if (typeof row.id !== "string") continue;
    const id = row.id.trim();
    if (!id || id.length > 80) continue;
    return id;
  }
  return null;
}

function chargeFromPayload(payload: unknown, op: string): AsaasCharge {
  return { id: requireId(payload, op), invoiceUrl: invoiceUrlFrom(payload) };
}

function requireId(payload: unknown, op: string): string {
  const id =
    payload && typeof payload === "object" && "id" in payload
      ? (payload as { id?: unknown }).id
      : undefined;
  if (typeof id !== "string" || !id.trim() || id.trim().length > 80) {
    throw new AsaasRequestError({
      status: 200,
      correlationId: randomUUID(),
      codes: ["invalid_id"],
      op,
    });
  }
  return id.trim();
}

function invoiceUrlFrom(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("invoiceUrl" in payload)) return null;
  const url = (payload as { invoiceUrl?: unknown }).invoiceUrl;
  return typeof url === "string" ? url : null;
}
