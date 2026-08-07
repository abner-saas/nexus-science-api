/**
 * QA end-to-end da API Nexus Science
 * Rode: npx tsx scripts/qa-api.ts
 */
import "dotenv/config";

const API = process.env.API_URL ?? "http://localhost:3333";

type Result = { name: string; ok: boolean; detail: string; status?: number };

const results: Result[] = [];
let cookies = "";

function pickCookies(res: Response) {
  // undici/node fetch: getSetCookie if available
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = anyHeaders.getSetCookie?.() ?? [];
  if (setCookies.length) {
    cookies = setCookies.map((c) => c.split(";")[0]).join("; ");
    return;
  }
  const single = res.headers.get("set-cookie");
  if (single) {
    // fallback rough parse
    cookies = single
      .split(/,(?=\s*\w+=)/)
      .map((c) => c.split(";")[0].trim())
      .join("; ");
  }
}

async function req(
  name: string,
  path: string,
  init?: RequestInit & { expect?: number | number[] },
) {
  const expect = init?.expect ?? [200, 201, 204];
  const expected = Array.isArray(expect) ? expect : [expect];
  try {
    const headers: Record<string, string> = {
      ...(cookies ? { Cookie: cookies } : {}),
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (init?.body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers,
    });
    pickCookies(res);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    const ok = expected.includes(res.status);
    results.push({
      name,
      ok,
      status: res.status,
      detail: ok
        ? `OK ${res.status}`
        : `Esperado ${expected.join("|")}, veio ${res.status}: ${text.slice(0, 200)}`,
    });
    return { res, body, ok };
  } catch (err) {
    results.push({
      name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return { res: null, body: null, ok: false };
  }
}

function section(title: string) {
  results.push({ name: `── ${title} ──`, ok: true, detail: "" });
}

async function main() {
  section("HEALTH");
  await req("GET /health", "/health");

  section("AUTH");
  await req("POST /auth/login (senha errada)", "/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@nexusscience.local", password: "wrongpassword" }),
    expect: 401,
  });
  await req("POST /auth/login", "/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@nexusscience.local",
      password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMeAdmin123!",
    }),
  });
  const me = await req("GET /auth/me", "/auth/me");
  const adminId = (me.body as { user?: { id: string } })?.user?.id;

  section("DASHBOARD");
  await req("GET /dashboard/summary", "/dashboard/summary");
  await req("POST /dashboard/recompute", "/dashboard/recompute", { method: "POST" });

  section("CRM / STUDENTS");
  const list = await req("GET /students", "/students");
  const students = (list.body as { data?: Array<{ id: string; name: string }> })?.data ?? [];
  let studentId = students[0]?.id;

  const created = await req("POST /students", "/students", {
    method: "POST",
    body: JSON.stringify({
      name: "QA Aluno Teste",
      email: `qa.aluno.${Date.now()}@test.local`,
      phone: "81999990000",
      city: "Recife",
      state: "PE",
      goal: "QA",
      value: "197.00",
      status: "Ativo",
      entryDate: new Date().toISOString().slice(0, 10),
      restrictions: "Nenhuma",
    }),
  });
  const newStudentId = (created.body as { data?: { id: string } })?.data?.id;
  if (newStudentId) studentId = newStudentId;

  if (studentId) {
    await req("GET /students/:id", `/students/${studentId}`);
    await req("PATCH /students/:id", `/students/${studentId}`, {
      method: "PATCH",
      body: JSON.stringify({ goal: "QA atualizado", priority: "Alta" }),
    });
  }

  section("PLANS");
  const plans = await req("GET /plans", "/plans");
  const planId = (plans.body as { data?: Array<{ id: string }> })?.data?.[0]?.id;
  const planCreate = await req("POST /plans", "/plans", {
    method: "POST",
    body: JSON.stringify({
      name: `QA Plan ${Date.now()}`,
      tier: "Custom",
      value: "99.00",
      benefits: ["QA"],
    }),
  });
  const newPlanId = (planCreate.body as { data?: { id: string } })?.data?.id;
  if (newPlanId) {
    await req("PATCH /plans/:id", `/plans/${newPlanId}`, {
      method: "PATCH",
      body: JSON.stringify({ value: "109.00" }),
    });
  }

  section("TRAINING");
  await req("GET /routines", "/routines");
  if (studentId) {
    const routine = await req("POST /routines", "/routines", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        name: "QA Rotina",
        objective: "Teste",
        frequency: 3,
        trainings: [
          {
            code: "A",
            name: "Treino QA",
            focus: "Full",
            dayOfWeek: "Segunda",
            duration: "40 min",
            exercises: [{ name: "Agachamento", group: "Quadríceps", sets: 3, reps: "10" }],
          },
        ],
      }),
    });
    const routineId = (routine.body as { data?: { id: string; trainings?: Array<{ id: string }> } })
      ?.data?.id;
    const trainingId = (routine.body as { data?: { trainings?: Array<{ id: string }> } })?.data
      ?.trainings?.[0]?.id;
    await req("GET /sessions", "/sessions");
    if (trainingId) {
      await req("POST /sessions", "/sessions", {
        method: "POST",
        body: JSON.stringify({
          studentId,
          trainingId,
          routineId,
          date: new Date().toISOString().slice(0, 10),
          status: "COMPLETED",
        }),
      });
    }
  }

  section("BIOFEEDBACK");
  if (studentId) {
    await req("GET /biofeedback", `/biofeedback?studentId=${studentId}&days=30`);
    await req("POST /biofeedback", "/biofeedback", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        date: new Date().toISOString().slice(0, 10),
        energy: 8,
        mood: 7,
        stress: 3,
        sleep: 8,
        musclePain: 2,
        hydration: "3.0",
        weight: "70.00",
      }),
    });
    await req("POST /biofeedback/insight", "/biofeedback/insight", {
      method: "POST",
      body: JSON.stringify({ studentId }),
    });
  }

  section("FINANCE");
  await req("GET /finance/summary", "/finance/summary");
  await req("GET /finance/transactions", "/finance/transactions");
  await req("POST /finance/transactions", "/finance/transactions", {
    method: "POST",
    body: JSON.stringify({
      type: "DESPESA",
      category: "QA",
      description: "Teste automatizado",
      amount: "10.00",
      date: new Date().toISOString().slice(0, 10),
    }),
  });

  section("PAYMENTS");
  await req("GET /payments", "/payments");
  if (studentId) {
    await req("POST /payments", "/payments", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        amount: "297.00",
        method: "PIX",
        dueDate: new Date().toISOString().slice(0, 10),
      }),
    });
  }

  section("ASSESSMENTS");
  if (studentId) {
    await req("GET /assessments", `/assessments?studentId=${studentId}`);
    await req("POST /assessments", "/assessments", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        date: new Date().toISOString().slice(0, 10),
        weight: "70.5",
        heightCm: 175,
        bodyFat: "18.0",
        muscle: "35.0",
        waist: "78.0",
        notes: "QA nota",
      }),
    });
  }

  section("RETENTION / AI");
  await req("GET /retention", "/retention");
  await req("GET /ai/insights", "/ai/insights");

  section("USERS / RBAC");
  await req("GET /users/roles", "/users/roles");
  await req("GET /users", "/users");
  const staffEmail = `qa.trainer.${Date.now()}@test.local`;
  const staff = await req("POST /users", "/users", {
    method: "POST",
    body: JSON.stringify({
      name: "QA Trainer",
      email: staffEmail,
      password: "TrainerQA123!",
      role: "TRAINER",
    }),
  });
  const staffId = (staff.body as { data?: { id: string } })?.data?.id;
  if (staffId) {
    await req("PATCH /users/:id role", `/users/${staffId}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "FINANCE" }),
    });
    await req("PATCH /users/:id deactivate", `/users/${staffId}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });
  }
  if (studentId) {
    await req("POST /users/student-access", "/users/student-access", {
      method: "POST",
      body: JSON.stringify({
        studentId,
        email: `qa.student.${Date.now()}@test.local`,
        password: "StudentQA123!",
        name: "QA Student Login",
      }),
    });
  }

  section("WEBHOOK ASAAS");
  await req("POST /webhooks/asaas (sem token)", "/webhooks/asaas", {
    method: "POST",
    body: JSON.stringify({ event: "PAYMENT_CONFIRMED", payment: { id: "pay_qa" } }),
    expect: 401,
  });
  await req("POST /webhooks/asaas (token)", "/webhooks/asaas", {
    method: "POST",
    headers: { "asaas-access-token": process.env.ASAAS_WEBHOOK_TOKEN ?? "dev_asaas_webhook_token_change_me" },
    body: JSON.stringify({
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_qa_nonexistent" },
    }),
  });

  section("AUTH REFRESH / LOGOUT");
  await req("POST /auth/refresh", "/auth/refresh", { method: "POST" });
  await req("POST /auth/logout", "/auth/logout", { method: "POST" });
  await req("GET /auth/me após logout", "/auth/me", { expect: 401 });

  // Report
  const failed = results.filter((r) => !r.ok && !r.name.startsWith("──"));
  const passed = results.filter((r) => r.ok && !r.name.startsWith("──"));

  console.log("\n========== QA API REPORT ==========\n");
  for (const r of results) {
    if (r.name.startsWith("──")) {
      console.log(`\n${r.name}`);
      continue;
    }
    console.log(`${r.ok ? "PASS" : "FAIL"} | ${r.name} | ${r.detail}`);
  }
  console.log(`\nTOTAL: ${passed.length} pass, ${failed.length} fail`);
  if (failed.length) {
    console.log("\nFAILURES:");
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
