// Leitura do Strava pela API oficial, devolvendo o mesmo formato que o app recebia do conector:
//   list_activities          -> { activities: [{ id, name, sport_type, start_local, summary: {...} }] }
//   get_activity_performance -> { has_heartrate, average_heartrate, max_heartrate, average_watts, calories, laps: [...] }
import { env, responde, corpo, usuario, banco, rota } from './_lib.js';
// A partir de 01/06/2027 os ids do Strava podem passar de 2^53 e perder precisão como número no JavaScript:
// usa o id_str (texto) quando vier, e o id numérico só como reserva.
const idDe = (x) => (x && x.id_str) || String(x && x.id);

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
  await banco('strava_cache', { method: 'POST', body: JSON.stringify(linhas.map((l) => ({ user_id: uid, activity_id: idDe(l), calorias: Math.round(l.calories || 0) }))) });
}

async function listar(uid, token, args) {
  const ini = args.range_start ? Math.floor(new Date(args.range_start + 'Z').getTime() / 1000) - 86400 : Math.floor(Date.now() / 1000) - 60 * 86400;
  const lista = await strava(token, '/athlete/activities?per_page=' + Math.min(Number(args.first) || 100, 100) + '&after=' + ini);
  const ids = lista.map((a) => idDe(a));
  const cache = ids.length ? await banco('strava_cache?select=activity_id,calorias&user_id=eq.' + uid + '&activity_id=in.(' + ids.join(',') + ')') : [];
  const kcal = Object.fromEntries(cache.map((c) => [c.activity_id, c.calorias]));
  // Calorias só vêm no detalhe da atividade: busca as que faltam, até 25 por vez.
  const faltam = lista.filter((a) => kcal[idDe(a)] === undefined).slice(0, 25);
  const det = await Promise.all(faltam.map((a) => strava(token, '/activities/' + idDe(a)).catch(() => null)));
  const novos = det.filter(Boolean);
  novos.forEach((d) => { kcal[idDe(d)] = Math.round(d.calories || 0); });
  await guardaCalorias(uid, novos);
  return {
    activities: lista.map((a) => ({
      id: idDe(a),
      name: a.name,
      sport_type: a.sport_type || a.type,
      start_local: String(a.start_date_local || '').replace('Z', ''),
      summary: {
        distance: a.distance, moving_time: a.moving_time, elapsed_time: a.elapsed_time,
        elevation_gain: a.total_elevation_gain, avg_speed: a.average_speed, max_speed: a.max_speed,
        avg_cadence: a.average_cadence, relative_effort: a.suffer_score, pr_count: a.pr_count,
        total_calories: kcal[idDe(a)] ?? null
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

// Detalhe completo de uma atividade, para a aba Desempenho: números, splits, melhores marcas,
// séries ao longo do percurso (reduzidas a ~240 pontos) e as zonas de FC do atleta.
function reduz(arr, n) {
  if (!arr || arr.length <= n) return arr || null;
  const passo = arr.length / n, out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * passo)]);
  out.push(arr[arr.length - 1]);
  return out;
}
async function detalhe(uid, token, args) {
  const id = encodeURIComponent(args.activity_id);
  const [d, st, zonas] = await Promise.all([
    strava(token, '/activities/' + id),
    strava(token, '/activities/' + id + '/streams?keys=time,distance,heartrate,velocity_smooth,altitude,watts,cadence&key_by_type=true').catch(() => ({})),
    strava(token, '/athlete/zones').catch(() => null)
  ]);
  await guardaCalorias(uid, [d]);
  const s = (k) => (st && st[k] && st[k].data) || null;
  const N = 240;
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    id: idDe(d), nome: d.name, tipo: d.sport_type || d.type, inicio: String(d.start_date_local || '').replace('Z', ''),
    km: d.distance ? Math.round(d.distance) / 1000 : 0, mov: d.moving_time, dec: d.elapsed_time, elev: d.total_elevation_gain,
    vmed: d.average_speed, vmax: d.max_speed, fc: d.average_heartrate || null, fcmax: d.max_heartrate || null,
    watts: d.average_watts || null, wmax: d.max_watts || null, kj: d.kilojoules || null, cad: d.average_cadence || null,
    kcal: d.calories || null, esforco: d.suffer_score || null, prs: d.pr_count || 0, conquistas: d.achievement_count || 0,
    dispositivo: d.device_name || null, ini_latlng: d.start_latlng || null, temp: d.average_temp ?? null,
    splits: (d.splits_metric || []).map((x) => ({ km: Math.round(x.distance) / 1000, seg: x.moving_time, v: x.average_speed, fc: x.average_heartrate ? Math.round(x.average_heartrate) : null, elev: x.elevation_difference })),
    melhores: (d.best_efforts || []).map((x) => ({ nome: x.name, seg: x.moving_time, pr: x.pr_rank || null })),
    serie: {
      t: reduz(s('time'), N), d: reduz(s('distance'), N)?.map((v) => Math.round(v)),
      fc: reduz(s('heartrate'), N), v: reduz(s('velocity_smooth'), N)?.map(r1),
      alt: reduz(s('altitude'), N)?.map(r1), w: reduz(s('watts'), N), cad: reduz(s('cadence'), N)
    },
    // Tiros de um treino intervalado, achados na série completa de velocidade.
    blocos: blocos(s('time'), s('distance'), s('velocity_smooth'), s('heartrate')),
    // Tempo em cada zona: calculado com a série completa de FC e tempo, não a reduzida.
    zonas_fc: (() => {
      // Sem permissão de perfil, usa as zonas padrão do Strava para FC máxima de 180.
      const z = (zonas && zonas.heart_rate && zonas.heart_rate.zones) || [{ min: 0, max: 106 }, { min: 107, max: 140 }, { min: 141, max: 158 }, { min: 159, max: 175 }, { min: 176, max: -1 }];
      const hr = s('heartrate'), tm = s('time');
      if (!z || !hr || !tm) return null;
      const seg = z.map(() => 0);
      for (let i = 1; i < hr.length; i++) {
        const dt = Math.min(30, tm[i] - tm[i - 1]);
        const k = z.findIndex((zz) => hr[i] >= zz.min && (zz.max === -1 || hr[i] <= zz.max));
        if (k >= 0) seg[k] += dt;
      }
      return z.map((zz, i) => ({ min: zz.min, max: zz.max, seg: seg[i], padrao: !(zonas && zonas.heart_rate) }));
    })()
  };
}

// Divide a corrida em trechos rápidos (tiros) e lentos (recuperação) pela velocidade.
// Só devolve quando parece intervalado: 3 ou mais tiros de 30 s a 8 min separados por trechos lentos.
function blocos(t, d, v, hr) {
  if (!t || !d || !v || v.length < 60) return null;
  const ord = v.filter((x) => x > 0.3).sort((a, b) => a - b);
  if (ord.length < 60) return null;
  const q = (p) => ord[Math.floor((ord.length - 1) * p)];
  const lento = q(0.15), rapido = q(0.9);
  if (rapido - lento < 0.8) return null;
  const lim = lento + 0.6 * (rapido - lento);
  // Média móvel de 15 s para não picotar.
  const sm = v.map((_, i) => { let s = 0, n = 0; for (let j = i; j >= 0 && t[i] - t[j] <= 15; j--) { s += v[j]; n++; } return s / n; });
  const segs = []; let ini = null;
  for (let i = 0; i < sm.length; i++) {
    const r = sm[i] >= lim;
    if (r && ini === null) ini = i;
    if ((!r || i === sm.length - 1) && ini !== null) { segs.push([ini, i]); ini = null; }
  }
  const juntar = (lista, gap) => { const o = []; lista.forEach((sg) => { const u = o[o.length - 1]; if (u && t[sg[0]] - t[u[1]] < gap) u[1] = sg[1]; else o.push(sg.slice()); }); return o; };
  let junt = juntar(segs, 12);
  // Uma pausa curta no meio do tiro (bem menor que a recuperação típica) não divide o tiro em dois.
  const gaps = []; for (let i = 1; i < junt.length; i++) gaps.push(t[junt[i][0]] - t[junt[i - 1][1]]);
  if (gaps.length >= 3) { const g = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]; junt = juntar(junt, Math.min(60, g * 0.5)); }
  const tiros = junt.filter((sg) => { const dur = t[sg[1]] - t[sg[0]]; return dur >= 30 && dur <= 480; }).map((sg) => {
    const dur = t[sg[1]] - t[sg[0]], dist = d[sg[1]] - d[sg[0]];
    let fm = 0, fs = 0, fn = 0; if (hr) for (let i = sg[0]; i <= sg[1]; i++) { if (hr[i] > fm) fm = hr[i]; fs += hr[i]; fn++; }
    return { ini: t[sg[0]], seg: dur, m: Math.round(dist), pace: dist > 0 ? Math.round(dur / (dist / 1000)) : null, fcmax: fm || null, fc: fn ? Math.round(fs / fn) : null };
  });
  if (tiros.length < 3) return null;
  const tTiros = tiros.reduce((a, x) => a + x.seg, 0), total = t[t.length - 1] - t[0];
  if (tTiros > total * 0.75) return null;
  const rec = [];
  for (let i = 1; i < tiros.length; i++) rec.push(tiros[i].ini - (tiros[i - 1].ini + tiros[i - 1].seg));
  return { tiros, rec };
}

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responde(res, 405, { erro: 'Use POST' });
  const u = await usuario(req);
  const { ferramenta, args = {} } = await corpo(req);
  const token = await tokenValido(u.id);
  if (ferramenta === 'list_activities') return responde(res, 200, { payload: await listar(u.id, token, args) });
  if (ferramenta === 'get_activity_detail') return responde(res, 200, { payload: await detalhe(u.id, token, args) });
  if (ferramenta === 'get_activity_performance') return responde(res, 200, { payload: await desempenho(u.id, token, args) });
  responde(res, 400, { erro: 'Ferramenta desconhecida' });
});
