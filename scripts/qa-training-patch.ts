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
  };
  if (init.body) headers["Content-Type"] = "application/json";
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

async function main() {
  await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@nexusscience.local",
      password: "ChangeMeAdmin123!",
    }),
  });
  const r = await call("/routines");
  const routine = r.body?.data?.[0];
  if (!routine) {
    console.log("NO_ROUTINE");
    return;
  }
  const t = routine.trainings?.[0];
  if (!t) {
    console.log("NO_TRAINING");
    return;
  }
  const patch = await call(`/trainings/${t.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      exercises: [{ name: "Leg Press", group: "Pernas", sets: 4, reps: "12", load: 80, rest: "90s" }],
    }),
  });
  console.log("PATCH training", patch.status, patch.body?.data?.exercises?.[0]?.name);

  const add = await call(`/routines/${routine.id}/trainings`, {
    method: "POST",
    body: JSON.stringify({
      code: "B",
      name: "Treino B",
      exercises: [{ name: "Remada", group: "Costas", sets: 3, reps: "10" }],
    }),
  });
  console.log("POST training", add.status, add.body?.data?.code);
}

main();
