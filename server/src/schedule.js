export function overlaps(start, end, otherStart, otherEnd) {
  return start < otherEnd && end > otherStart;
}

export const completedEarlySql =
  "a.status = 'concluido' AND a.completed_on IS NOT NULL AND a.completed_on < substr(a.starts_at, 1, 10)";

export function findScheduleConflict(db, {
  tenantId,
  professionalId,
  startsAt,
  endsAt,
  excludeAppointmentId = null,
}) {
  const appointment = db.prepare(`
    SELECT id, starts_at AS startsAt, ends_at AS endsAt
    FROM appointments a
    WHERE tenant_id = ?
      AND professional_id = ?
      AND status NOT IN ('cancelado', 'faltou')
      AND NOT (${completedEarlySql})
      AND starts_at < ?
      AND ends_at > ?
      AND (? IS NULL OR id != ?)
    LIMIT 1
  `).get(tenantId, professionalId, endsAt, startsAt, excludeAppointmentId, excludeAppointmentId);

  if (appointment) return { type: "atendimento", ...appointment };

  const blocked = db.prepare(`
    SELECT id, starts_at AS startsAt, ends_at AS endsAt, reason
    FROM blocked_slots
    WHERE tenant_id = ?
      AND (professional_id IS NULL OR professional_id = ?)
      AND starts_at < ?
      AND ends_at > ?
    LIMIT 1
  `).get(tenantId, professionalId, endsAt, startsAt);

  return blocked ? { type: "bloqueio", ...blocked } : null;
}
