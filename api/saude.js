// Recebe os dados do Health Connect (app "Health Connect Webhook" no Android) e
// mostra ao app a chave para configurar o envio.
//  GET  (com login)            → { url, chave, ultimoEnvio }
//  POST (com login) {novo:true} → gera chave nova
//  POST com cabeçalho x-api-key → recebe o JSON do Health Connect Webhook
import crypto from 'node:crypto';
import { env, responde, corpo, usuario, banco, rota } from './_lib.js';

const FUSO = 'America/Sao_Paulo';
const IGNORA = new Set(['timestamp', 'app_version', 'timezone', 'deleted']);
const enc = encodeURIComponent;

function diaLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function horaLocal(iso) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
function tempoDe(r) { return r.time || r.start_time || r.session_end_time || r.end_time || null; }

async function chaveDe(uid, nova) {
  if (!nova) {
    const r = await banco('saude_tokens?select=token,ultimo_envio&user_id=eq.' + uid);
    if (r && r[0]) return r[0];
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const r = await banco('saude_tokens?on_conflict=user_id', { method: 'POST', body: JSON.stringify({ user_id: uid, token, criado: new Date().toISOString(), ultimo_envio: null }) });
  return r[0];
}

async function docs(uid, colecao, ids) {
  if (!ids.length) return {};
  const r = await banco('docs?select=id,data&user_id=eq.' + uid + '&colecao=eq.' + colecao + '&id=in.(' + ids.map((i) => '"' + i + '"').join(',') + ')');
  const m = {}; (r || []).forEach((d) => { m[d.id] = d.data; }); return m;
}
async function grava(uid, colecao, mapa) {
  const linhas = Object.keys(mapa).map((id) => ({ user_id: uid, colecao, id, data: mapa[id], atualizado: new Date().toISOString() }));
  if (linhas.length) await banco('docs?on_conflict=user_id,colecao,id', { method: 'POST', body: JSON.stringify(linhas), headers: { Prefer: 'return=minimal,resolution=merge-duplicates' } });
}

async function recebe(uid, p) {
  // 1) Guarda tudo como veio, para usos futuros.
  const linhas = [];
  for (const tipo of Object.keys(p)) {
    if (IGNORA.has(tipo) || !Array.isArray(p[tipo])) continue;
    for (const r of p[tipo]) {
      const t = tempoDe(r);
      const rid = (r.metadata && r.metadata.id) || (t ? t : crypto.createHash('sha1').update(JSON.stringify(r)).digest('hex'));
      linhas.push({ user_id: uid, tipo, rid: String(rid), tempo: t, valor: r, origem: r.metadata && r.metadata.data_origin || null, recebido: new Date().toISOString() });
    }
  }
  for (let i = 0; i < linhas.length; i += 500) {
    await banco('saude_registros?on_conflict=user_id,tipo,rid', { method: 'POST', body: JSON.stringify(linhas.slice(i, i + 500)), headers: { Prefer: 'return=minimal,resolution=merge-duplicates' } });
  }
  for (const d of (Array.isArray(p.deleted) ? p.deleted : [])) {
    if (d && d.type && d.id) await banco('saude_registros?user_id=eq.' + uid + '&tipo=eq.' + enc(d.type) + '&rid=eq.' + enc(d.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }

  // 2) Composição corporal por dia (último valor do dia de cada medida).
  const CAMPOS = {
    weight: ['peso_kg', (r) => r.kilograms],
    body_fat: ['gordura_pct', (r) => r.percentage],
    lean_body_mass: ['massa_magra_kg', (r) => r.kilograms],
    bone_mass: ['massa_ossea_kg', (r) => r.kilograms],
    basal_metabolic_rate: ['tmb_kcal', (r) => r.watts != null ? Math.round(r.watts * 20.65) : null]
  };
  const comp = {};
  for (const tipo of Object.keys(CAMPOS)) {
    for (const r of (p[tipo] || [])) {
      const t = tempoDe(r), dia = t && diaLocal(t), v = CAMPOS[tipo][1](r);
      if (!dia || v == null || isNaN(v)) continue;
      const c = comp[dia] || (comp[dia] = { _t: {} }), campo = CAMPOS[tipo][0];
      if (!c._t[campo] || t > c._t[campo]) { c._t[campo] = t; c[campo] = Math.round(v * 100) / 100; if (tipo === 'weight') c.hora = horaLocal(t); }
    }
  }
  const dias = Object.keys(comp);
  if (dias.length) {
    const atual = await docs(uid, 'composicao', dias), pesos = await docs(uid, 'peso', dias);
    const novos = {}, novosPeso = {};
    for (const dia of dias) {
      const c = comp[dia]; delete c._t;
      novos[dia] = Object.assign({}, atual[dia] || {}, c, { data: dia, origem: 'health-connect', atualizado: new Date().toISOString() });
      // Peso do dia: preenche se não houver um digitado à mão.
      if (c.peso_kg && (!pesos[dia] || pesos[dia].origem === 'health-connect')) {
        novosPeso[dia] = { data: dia, kg: c.peso_kg, origem: 'health-connect', atualizado: new Date().toISOString() };
      }
    }
    await grava(uid, 'composicao', novos);
    await grava(uid, 'peso', novosPeso);
  }

  // 3) Resumo do dia: FC de repouso, sono e passos.
  const resumo = {};
  const pega = (dia) => resumo[dia] || (resumo[dia] = {});
  for (const r of (p.resting_heart_rate || [])) {
    const t = tempoDe(r), dia = t && diaLocal(t); if (!dia || r.bpm == null) continue;
    const x = pega(dia); if (!x._fc || t > x._fc) { x._fc = t; x.fc_repouso = r.bpm; }
  }
  const diasSono = new Set(), diasPassos = new Set();
  for (const r of (p.sleep || [])) { const d = r.session_end_time && diaLocal(r.session_end_time); if (d) { diasSono.add(d); pega(d); } }
  for (const r of (p.steps || [])) { const d = r.start_time && diaLocal(r.start_time); if (d) { diasPassos.add(d); pega(d); } }
  const janela = (dia) => {
    const ini = new Date(dia + 'T00:00:00-03:00'), fim = new Date(ini.getTime() + 864e5);
    return '&tempo=gte.' + enc(ini.toISOString()) + '&tempo=lt.' + enc(fim.toISOString());
  };
  for (const dia of diasPassos) {
    const r = await banco('saude_registros?select=valor&user_id=eq.' + uid + '&tipo=eq.steps' + janela(dia));
    pega(dia).passos = (r || []).reduce((s, x) => s + (Number(x.valor.count) || 0), 0);
  }
  for (const dia of diasSono) {
    const r = await banco('saude_registros?select=valor&user_id=eq.' + uid + '&tipo=eq.sleep' + janela(dia));
    let seg = 0;
    for (const x of (r || [])) {
      const st = x.valor.stages || [];
      // Soma só o tempo dormindo (sem os trechos acordado), quando há fases.
      const dormindo = st.filter((s) => !/AWAKE|OUT_OF_BED|UNKNOWN/i.test(String(s.stage)) && s.end_time);
      seg += dormindo.length ? dormindo.reduce((a, s) => a + (new Date(s.end_time) - new Date(s.start_time)) / 1000, 0) : (Number(x.valor.duration_seconds) || 0);
    }
    pega(dia).sono_min = Math.round(seg / 60);
  }
  const diasR = Object.keys(resumo);
  if (diasR.length) {
    const atual = await docs(uid, 'saude_dia', diasR), novos = {};
    for (const dia of diasR) {
      const x = resumo[dia]; delete x._fc;
      novos[dia] = Object.assign({}, atual[dia] || {}, x, { data: dia, atualizado: new Date().toISOString() });
    }
    await grava(uid, 'saude_dia', novos);
  }
  return { registros: linhas.length, composicao: dias.length, dias: diasR.length };
}

export default rota(async (req, res) => {
  const chave = req.headers['x-api-key'];
  if (req.method === 'POST' && chave) {
    const r = await banco('saude_tokens?select=user_id&token=eq.' + enc(String(chave)));
    if (!r || !r[0]) return responde(res, 401, { erro: 'Chave inválida' });
    const uid = r[0].user_id;
    const resultado = await recebe(uid, await corpo(req));
    await banco('saude_tokens?user_id=eq.' + uid, { method: 'PATCH', body: JSON.stringify({ ultimo_envio: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
    return responde(res, 200, { ok: true, ...resultado });
  }
  const u = await usuario(req);
  const nova = req.method === 'POST' && (await corpo(req)).novo === true;
  const t = await chaveDe(u.id, nova);
  responde(res, 200, { url: env('APP_URL').replace(/\/$/, '') + '/api/saude', chave: t.token, ultimoEnvio: t.ultimo_envio || null });
});
