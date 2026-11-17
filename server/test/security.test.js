import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

test("commercial setup, authenticated account and staff password rotation", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "simplifica-security-"));
  const previous = {
    DATABASE_PATH: process.env.DATABASE_PATH,
    INSTALL_TOKEN: process.env.INSTALL_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    DEMO_MODE: process.env.DEMO_MODE,
  };
  process.env.DATABASE_PATH = path.join(tmp, "test.sqlite");
  process.env.INSTALL_TOKEN = randomBytes(32).toString("hex");
  process.env.NODE_ENV = "test";
  process.env.DEMO_MODE = "false";

  const { default: app } = await import("../src/app.js");
  const { db } = await import("../src/database.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  async function request(route, method = "GET", body, headers = {}) {
    const response = await fetch(`${base}/api${route}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  try {
    assert.equal((await request("/installation/status")).body.needsSetup, true);
    const setup = await request("/installation/setup", "POST", {
      businessName: "Comércio Teste", slug: "comercio-teste", ownerName: "Administrador",
      ownerEmail: "dono@teste.local", password: "Password-Forte-1234",
      installToken: process.env.INSTALL_TOKEN,
    });
    assert.equal(setup.status, 201);
    assert.equal((await request("/installation/status")).body.needsSetup, false);
    assert.equal((await request("/installation/setup", "POST", { installToken: process.env.INSTALL_TOKEN })).status, 409);

    const denied = await request("/auth/login", "POST", {
      email: "dono@teste.local", password: "senha-incorreta",
    });
    assert.equal(denied.status, 401);

    const login = await request("/auth/login", "POST", {
      email: "dono@teste.local", password: "Password-Forte-1234",
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.slug, "comercio-teste");
    assert.equal((await request("/account")).body.account.name, "Administrador");

    const blockedOrigin = await request("/account", "PATCH", {
      currentPassword: "Password-Forte-1234", name: "Invasor",
    }, { Origin: "https://example.invalid" });
    assert.equal(blockedOrigin.status, 403);
    const wrongPassword = await request("/account", "PATCH", {
      currentPassword: "errada", name: "Novo Nome",
    });
    assert.equal(wrongPassword.status, 403);
    const changed = await request("/account", "PATCH", {
      currentPassword: "Password-Forte-1234", newPassword: "Nova-Senha-Forte-1234", name: "Novo Nome",
    });
    assert.equal(changed.status, 200);
    assert.equal((await request("/account")).body.account.name, "Novo Nome");

    const member = await request("/team-members", "POST", {
      name: "Recepcionista", email: "recepcao@teste.local", password: "Senha-Inicial-1234",
      role: "recepcao",
    });
    assert.equal(member.status, 201);
    const reset = await request(`/team-members/${member.body.id}/reset-password`, "POST", {
      password: "Senha-Renovada-1234",
    });
    assert.equal(reset.status, 200);
    const badMemberLogin = await request("/auth/login", "POST", {
      email: "recepcao@teste.local", password: "Senha-Inicial-1234",
    });
    assert.equal(badMemberLogin.status, 401);
    const goodMemberLogin = await request("/auth/login", "POST", {
      email: "recepcao@teste.local", password: "Senha-Renovada-1234",
    });
    assert.equal(goodMemberLogin.status, 200);
    assert.equal(goodMemberLogin.body.user.role, "recepcao");
    const deniedReset = await request(`/team-members/${member.body.id}/reset-password`, "POST", {
      password: "Outra-Senha-Forte-1234",
    });
    assert.equal(deniedReset.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
