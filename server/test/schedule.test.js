import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { findScheduleConflict, overlaps } from "../src/schedule.js";

test("considera conflito apenas quando os intervalos se sobrepõem", () => {
  assert.equal(overlaps("09:30", "10:30", "10:00", "11:00"), true);
  assert.equal(overlaps("09:00", "10:00", "10:00", "11:00"), false);
  assert.equal(overlaps("10:00", "11:00", "09:00", "10:00"), false);
});

test("libera cancelamentos, faltas e conclusões em data anterior e permite excluir a própria reserva", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE appointments (
      id TEXT, tenant_id TEXT, professional_id TEXT, starts_at TEXT, ends_at TEXT, status TEXT, completed_on TEXT
    );
    CREATE TABLE blocked_slots (
      id TEXT, tenant_id TEXT, professional_id TEXT, starts_at TEXT, ends_at TEXT, reason TEXT
    );
    INSERT INTO appointments VALUES
      ('cancelled', 't', 'p', '2026-10-10T09:00:00', '2026-10-10T10:00:00', 'cancelado', NULL),
      ('missed', 't', 'p', '2026-10-10T09:00:00', '2026-10-10T10:00:00', 'faltou', NULL),
      ('active', 't', 'p', '2026-10-10T10:00:00', '2026-10-10T11:00:00', 'agendado', NULL),
      ('early', 't', 'p', '2026-10-10T09:00:00', '2026-10-10T10:00:00', 'concluido', '2026-10-09'),
      ('same-day', 't', 'p', '2026-10-10T11:00:00', '2026-10-10T12:00:00', 'concluido', '2026-10-10'),
      ('legacy', 't', 'p', '2026-10-10T12:00:00', '2026-10-10T13:00:00', 'concluido', NULL);
  `);

  assert.equal(findScheduleConflict(db, {
    tenantId: "t",
    professionalId: "p",
    startsAt: "2026-10-10T09:00:00",
    endsAt: "2026-10-10T10:00:00",
  }), null);

  assert.equal(findScheduleConflict(db, {
    tenantId: "t",
    professionalId: "p",
    startsAt: "2026-10-10T10:00:00",
    endsAt: "2026-10-10T11:00:00",
    excludeAppointmentId: "active",
  }), null);

  assert.equal(findScheduleConflict(db, {
    tenantId: "t",
    professionalId: "p",
    startsAt: "2026-10-10T10:30:00",
    endsAt: "2026-10-10T11:30:00",
  }).id, "active");

  for (const [hour, end, id] of [["11", "12", "same-day"], ["12", "13", "legacy"]]) {
    assert.equal(findScheduleConflict(db, {
      tenantId: "t",
      professionalId: "p",
      startsAt: `2026-10-10T${hour}:00:00`,
      endsAt: `2026-10-10T${end}:00:00`,
    }).id, id);
  }

  db.close();
});

test("reconhece bloqueio global ou individual do profissional", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE appointments (
      id TEXT, tenant_id TEXT, professional_id TEXT, starts_at TEXT, ends_at TEXT, status TEXT, completed_on TEXT
    );
    CREATE TABLE blocked_slots (
      id TEXT, tenant_id TEXT, professional_id TEXT, starts_at TEXT, ends_at TEXT, reason TEXT
    );
    INSERT INTO blocked_slots VALUES
      ('global', 't', NULL, '2026-10-10T12:00:00', '2026-10-10T13:00:00', 'Almoço');
  `);

  assert.equal(findScheduleConflict(db, {
    tenantId: "t",
    professionalId: "p",
    startsAt: "2026-10-10T12:15:00",
    endsAt: "2026-10-10T12:45:00",
  }).type, "bloqueio");

  db.close();
});
