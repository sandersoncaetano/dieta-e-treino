// Chamado pelo banco (pg_cron) quando um aviso de descanso vence. Envia a notificação para o celular.
import webpush from 'web-push';
import { env, responde, corpo, banco, rota } from './_lib.js';

export default rota(async (req, res) => {
  if (req.headers['x-cron-secret'] !== env('CRON_SECRET')) return responde(res, 403, { erro: 'segredo' });
  const { ids = [] } = await corpo(req);
  if (!ids.length) return responde(res, 200, { enviados: 0 });
  webpush.setVapidDetails('mailto:' + env('EMAILS_PERMITIDOS').split(',')[0].trim(), env('VAPID_PUBLIC'), env('VAPID_PRIVATE'));
  const alertas = await banco('alertas?select=id,user_id,titulo,corpo,dispara_em&id=in.(' + ids.join(',') + ')');
  let enviados = 0;
  for (const a of alertas) {
    const subs = await banco('push_inscricoes?select=endpoint,p256dh,auth&user_id=eq.' + a.user_id);
    const msg = JSON.stringify({ titulo: a.titulo, corpo: a.corpo || '', tag: 'descanso', quando: a.dispara_em });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg, { TTL: 60, urgency: 'high' });
        enviados++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await banco('push_inscricoes?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        else console.error('push', e.statusCode, e.body);
      }
    }));
  }
  responde(res, 200, { enviados });
});
