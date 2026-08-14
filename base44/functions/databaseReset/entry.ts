import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  APP_ENVIRONMENT,
  TRANSACTION_ENTITIES,
  FULL_ONLY_ENTITIES,
  RESET_SEQUENCE_PREFIXES,
} from '../../shared/dbManagement.js';

export default async function (req) {
  let base44;
  let user;
  try {
    base44 = createClientFromRequest(req);
    user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (APP_ENVIRONMENT === 'production') {
      return Response.json({ error: 'Reset database tidak tersedia pada environment Production.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { mode = 'transaction', resetSequences = true, skipBackup = false, confirm } = body;
    if (confirm !== 'RESET DATABASE LAB PRO') {
      return Response.json({ error: 'Kalimat konfirmasi tidak sesuai.' }, { status: 400 });
    }
    if (mode !== 'transaction' && mode !== 'full') {
      return Response.json({ error: 'Mode reset tidak valid.' }, { status: 400 });
    }

    const entities = mode === 'full' ? [...TRANSACTION_ENTITIES, ...FULL_ONLY_ENTITIES] : TRANSACTION_ENTITIES;
    const deleted = {};
    for (const name of entities) {
      try {
        const before = await base44.asServiceRole.entities[name].list('-created_date', 10000);
        const count = (before || []).length;
        await base44.asServiceRole.entities[name].deleteMany({});
        deleted[name] = count;
      } catch (e) {
        deleted[name] = `error: ${e.message}`;
      }
    }

    let sequencesReset = 0;
    if (resetSequences) {
      try {
        const seqs = await base44.asServiceRole.entities.DocumentSequence.filter({});
        const toDelete = (seqs || []).filter((s) => RESET_SEQUENCE_PREFIXES.includes(s.prefix));
        for (const s of toDelete) {
          try {
            await base44.asServiceRole.entities.DocumentSequence.delete(s.id);
            sequencesReset++;
          } catch {}
        }
      } catch {}
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action_time: new Date().toISOString(),
      user_name: user.email || user.full_name || 'admin',
      module: 'database',
      action: 'DATABASE_RESET_COMPLETED',
      reason: `mode=${mode}; resetSequences=${resetSequences}; skipBackup=${skipBackup}; sequencesReset=${sequencesReset}; environment=${APP_ENVIRONMENT}`,
      data_after: JSON.stringify(deleted),
    });

    return Response.json({ ok: true, mode, deleted, sequencesReset });
  } catch (error) {
    try {
      if (base44 && user) {
        await base44.asServiceRole.entities.AuditLog.create({
          action_time: new Date().toISOString(),
          user_name: user.email || '',
          module: 'database',
          action: 'DATABASE_RESET_FAILED',
          reason: error.message,
        });
      }
    } catch {}
    return Response.json({ error: error.message }, { status: 500 });
  }
}