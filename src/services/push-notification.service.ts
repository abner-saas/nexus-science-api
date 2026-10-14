import { and, eq, inArray } from "drizzle-orm";
import Expo, { type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import type { FastifyBaseLogger } from "fastify";
import { db } from "../db/index.js";
import { devicePushTokens, users } from "../db/schema.js";
import { env } from "../lib/env.js";
import type { UserRole } from "../types/auth.js";

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

type PushLog = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

const fallbackLog: PushLog = {
  info(obj, msg) {
    console.info(msg ?? "push", obj);
  },
  error(obj, msg) {
    console.error(msg ?? "push", obj);
  },
};

function asPushLog(log?: FastifyBaseLogger): PushLog {
  if (!log) return fallbackLog;
  return {
    info: (obj, msg) => log.info(obj, msg),
    error: (obj, msg) => log.error(obj, msg),
  };
}

/** Só o prefixo — o token de device nunca vai inteiro pro log. */
function maskToken(token: string): string {
  return `${token.slice(0, 8)}***`;
}

let expoClient: Expo | undefined;

function getExpoClient(): Expo {
  if (!expoClient) {
    expoClient = new Expo({ accessToken: env.EXPO_ACCESS_TOKEN });
  }
  return expoClient;
}

/** Ticket de erro pode trazer o token inteiro em `details` — nunca logar isso. */
function ticketLog(ticket: ExpoPushTicket): Record<string, unknown> {
  if (ticket.status === "ok") return { status: "ok" };
  const raw = ticket.details?.expoPushToken;
  return {
    status: "error",
    message: ticket.message,
    error: ticket.details?.error,
    tokenPrefix: raw ? maskToken(raw) : undefined,
  };
}

/**
 * Disparo de push para os devices dos usuários.
 *
 * Sem `EXPO_ACCESS_TOKEN` só registra o prefixo do token e retorna.
 * Com o token, envia pela Expo Push API (`expo-server-sdk`). Nunca lança:
 * falha de push não pode derrubar o request que a chamou.
 */
export async function notifyUsers(
  userIds: string[],
  payload: PushPayload,
  log?: FastifyBaseLogger,
): Promise<void> {
  const sink = asPushLog(log);
  try {
    const ids = [...new Set(userIds.filter((id) => id.length > 0))];
    if (ids.length === 0) return;

    const rows = await db
      .select({ token: devicePushTokens.token })
      .from(devicePushTokens)
      .where(inArray(devicePushTokens.userId, ids));

    const tokenPrefixes = rows.map((row) => maskToken(row.token));
    const detail = { devices: rows.length, tokenPrefixes, title: payload.title };
    if (!env.EXPO_ACCESS_TOKEN) {
      sink.info(detail, "push não enviado: sender Expo não configurado");
      return;
    }

    const messages: ExpoPushMessage[] = [];
    for (const row of rows) {
      if (!Expo.isExpoPushToken(row.token)) {
        sink.info({ tokenPrefix: maskToken(row.token) }, "push ignorado: token não é Expo");
        continue;
      }
      messages.push({
        to: row.token,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        sound: "default",
      });
    }
    if (messages.length === 0) return;

    const expo = getExpoClient();
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        const errors = tickets.filter((ticket) => ticket.status === "error").map(ticketLog);
        if (errors.length > 0) {
          sink.error({ errors, title: payload.title }, "Expo recusou parte do push");
        }
      } catch (err) {
        sink.error({ err, title: payload.title }, "Falha ao enviar chunk de push");
      }
    }
  } catch (err) {
    sink.error({ err }, "Falha ao preparar push");
  }
}

/** Users ativos dos papéis pedidos, mais o login STUDENT ligado ao aluno. */
export async function listUserIdsForPush(input: {
  roles?: readonly UserRole[];
  studentId?: string;
}): Promise<string[]> {
  const ids: string[] = [];
  const roles = input.roles ? [...input.roles] : [];
  if (roles.length > 0) {
    const staff = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.active, true), inArray(users.role, roles)));
    ids.push(...staff.map((row) => row.id));
  }
  if (input.studentId) {
    const linked = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.active, true),
          eq(users.role, "STUDENT"),
          eq(users.studentId, input.studentId),
        ),
      );
    ids.push(...linked.map((row) => row.id));
  }
  return [...new Set(ids)];
}
