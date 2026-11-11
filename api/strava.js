// Leitura do Strava pela API oficial, devolvendo o mesmo formato que o app recebia do conector:
//   list_activities          -> { activities: [{ id, name, sport_type, start_local, summary: {...} }] }
//   get_activity_performance -> { has_heartrate, average_heartrate, max_heartrate, average_watts, calories, laps: [...] }
import { env, responde, corpo, usuario, banco, rota } from './_lib.js';

export const config = { maxDuration: 60 };

async function tokenValido(uid) {
  const [t] = await banco('strava_tokens?select=*&user_id=eq.' + uid);
  if (!t) throw Object.assign(new Error('Strava não conectado'), { status: 409, code: 'strava_desconectado' });
  if (t.expires_at > Date.now() / 1000 + 120) return t.access_token;
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env('STRAVA_CLIENT_ID'), client_secret: env('STRAVA_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: t.refresh_token })
  });
  const n = await r.json();
  if (!r.ok) throw Object.assign(new Error('Reconecte o Strava'), { status: 409, code: 'strava_desconectado' });
  await banco('strava_tokens', { method: 'POST', body: JSON.stringify({ user_id: uid, access_token: n.access_token, refresh_token: n.refresh_token, expires_at: n.expires_at }) });
  return n.access_token;
}

async function strava(token, caminho) {
  const r = await fetch('https://www.strava.com/api/v3' + caminho, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 429) throw Object.assign(new Error('Limite do Strava atingido; tente em 15 minutos'), { status: 429, code: 'limite' });
  if (r.status === 401) throw Object.assign(new Error('Reconecte o Strava'), { status: 409, code: 'strava_desconectado' });
  if (!r.ok) throw Object.assign(new Error('Strava respondeu ' + r.status), { status: 502, code: 'strava' });
  return r.json();
}

async function guardaCalorias(uid, linhas) {
  if (!linhas.length) return;
  await banco('strava_cache', { method: 'POST', body: JSON.stringify(linhas.map((l) => ({ user_id: uid, activity_id: String(l.id), calorias: Math.round(l.calories || 0) }))) });
}

async function listar(uid, token, args) {
  const ini = args.range_start ? Math.floor(new Date(args.range_start + 'Z').getTime() / 1000) - 86400 : Math.floor(Date.now() / 1000) - 60 * 86400;
  const lista = await strava(token, '/athlete/activities?per_page=' + Math.min(Number(args.first) || 100, 100) + '&after=' + ini);
  const ids = lista.map((a) => String(a.id));
  const cache = ids.length ? await banco('strava_cache?select=activity_id,calorias&user_id=eq.' + uid + '&activity_id=in.(' + ids.join(',') + ')') : [];
  const kcal = Object.fromEntries(cache.map((c) => [c.activity_id, c.calorias]));
  // Calorias só vêm no detalhe da atividade: busca as que faltam, até 25 por vez.
  const faltam = lista.filter((a) => kcal[String(a.id)] === undefined).slice(0, 25);
  const det = await Promise.all(faltam.map((a) => strava(token, '/activities/' + a.id).catch(() => null)));
  const novos = det.filter(Boolean);
  novos.forEach((d) => { kcal[String(d.id)] = Math.round(d.calories || 0); });
  await guardaCalorias(uid, novos);
  return {
    activities: lista.map((a) => ({
      id: String(a.id),
      name: a.name,
      sport_type: a.sport_type || a.type,
      start_local: String(a.start_date_local || '').replace('Z', ''),
      summary: {
        distance: a.distance, moving_time: a.moving_time, elapsed_time: a.elapsed_time,
        elevation_gain: a.total_elevation_gain, avg_speed: a.average_speed, max_speed: a.max_speed,
        avg_cadence: a.average_cadence, relative_effort: a.suffer_score, pr_count: a.pr_count,
        total_calories: kcal[String(a.id)] ?? null
      },
      weather: null
    }))
  };
}

async function desempenho(uid, token, args) {
  const d = await strava(token, '/activities/' + encodeURIComponent(args.activity_id));
  await guardaCalorias(uid, [d]);
  return {
    has_heartrate: !!d.has_heartrate,
    average_heartrate: d.average_heartrate || null,
    max_heartrate: d.max_heartrate || null,
    average_watts: d.average_watts || null,
    average_cadence: d.average_cadence || null,
    calories: d.calories || null,
    laps: (d.laps || []).map((l) => ({
      distance: l.distance, moving_time: l.moving_time, elapsed_time: l.elapsed_time,
      avg_hr: l.average_heartrate, max_hr: l.max_heartrate, avg_speed: l.average_speed, avg_cadence: l.average_cadence
    }))
  };
}

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responde(res, 405, { erro: 'Use POST' });
  const u = await usuario(req);
  const { ferramenta, args = {} } = await corpo(req);
  const token = await tokenValido(u.id);
  if (ferramenta === 'list_activities') return responde(res, 200, { payload: await listar(u.id, token, args) });
  if (ferramenta === 'get_activity_performance') return responde(res, 200, { payload: await desempenho(u.id, token, args) });
  responde(res, 400, { erro: 'Ferramenta desconhecida' });
});
