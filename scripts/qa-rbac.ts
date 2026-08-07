import "dotenv/config";

const API = "http://localhost:3333";
let cookies = "";

function pick(res: Response) {
  const anyH = res.headers as Headers & { getSetCookie?: () => string[] };
  const sc = anyH.getSetCookie?.() ?? [];
  if (sc.length) cookies = sc.map((c) => c.split(";")[0]).join("; ");
}

async function call(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...(cookies ? { Cookie: cookies } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, { ...init, headers });
  pick(res);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { status: res.status, body };
}

const fails: string[] = [];
function assert(name: string, cond: boolean, detail: string | number) {
  if (!cond) {
    fails.push(`${name}: ${detail}`);
    console.log("FAIL", name, detail);
  } else console.log("PASS", name);
}

async function main() {
  cookies = "";
  await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@nexusscience.local",
      password: "ChangeMeAdmin123!",
    }),
  });

  const email = `rbac.trainer.${Date.now()}@test.local`;
  const t = await call("/users", {
    method: "POST",
    body: JSON.stringify({
      name: "RBAC Trainer",
      email,
      password: "TrainerQA123!",
      role: "TRAINER",
    }),
  });
  assert("create trainer", t.status === 201, t.status);

  const students = await call("/students");
  const sid = students.body?.data?.[0]?.id as string | undefined;
  if (sid && t.body?.data?.id) {
    await call(`/students/${sid}`, {
      method: "PATCH",
      body: JSON.stringify({ trainerId: t.body.data.id }),
    });
  }

  cookies = "";
  const login = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "TrainerQA123!" }),
  });
  assert("trainer login", login.status === 200, login.status);

  const fin = await call("/finance/summary");
  assert("trainer blocked finance", fin.status === 403, fin.status);

  const users = await call("/users");
  assert("trainer blocked users admin", users.status === 403, users.status);

  const st = await call("/students");
  assert("trainer can list students", st.status === 200, st.status);
  const ids = (st.body?.data ?? []).map((s: { trainerId: string }) => s.trainerId);
  assert(
    "trainer only assigned students",
    ids.every((id: string) => id === t.body.data.id),
    ids.join(","),
  );

  cookies = "";
  await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@nexusscience.local",
      password: "ChangeMeAdmin123!",
    }),
  });
  const femail = `rbac.fin.${Date.now()}@test.local`;
  await call("/users", {
    method: "POST",
    body: JSON.stringify({
      name: "RBAC Fin",
      email: femail,
      password: "FinanceQA123!",
      role: "FINANCE",
    }),
  });

  cookies = "";
  await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: femail, password: "FinanceQA123!" }),
  });
  const finOk = await call("/finance/summary");
  assert("finance can summary", finOk.status === 200, finOk.status);
  const routines = await call("/routines", {
    method: "POST",
    body: JSON.stringify({ studentId: sid, name: "X", frequency: 3 }),
  });
  assert("finance blocked create routine", routines.status === 403, routines.status);

  // Student login
  cookies = "";
  await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@nexusscience.local",
      password: "ChangeMeAdmin123!",
    }),
  });
  const semail = `rbac.stu.${Date.now()}@test.local`;
  const sa = await call("/users/student-access", {
    method: "POST",
    body: JSON.stringify({
      studentId: sid,
      email: semail,
      password: "StudentQA123!",
      name: "RBAC Student",
    }),
  });
  assert("create student access", sa.status === 201, sa.status);

  cookies = "";
  const slog = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: semail, password: "StudentQA123!" }),
  });
  assert("student login", slog.status === 200, slog.status);
  const sfin = await call("/finance/summary");
  assert("student blocked finance", sfin.status === 403, sfin.status);
  const sstud = await call("/students");
  assert("student blocked staff CRM list", sstud.status === 403, sstud.status);

  console.log(`\nRBAC: ${fails.length} fail(s)`);
  if (fails.length) process.exit(1);
}

main();
