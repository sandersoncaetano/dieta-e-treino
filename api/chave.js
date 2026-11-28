// Chave de IA da pessoa (Anthropic).
//  POST {acao:'status'}         → { tem, final, usaServidor }
//  POST {acao:'salvar', chave}  → testa a chave na Anthropic e guarda cifrada
//  POST {acao:'remover'}
import { responde, corpo, usuario, banco, rota, cifra } from './_lib.js';
const semPref = { Prefer: 'return=minimal' };

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responde(res, 405, { erro: 'Use POST' });
  const b = await corpo(req);
  const u = await usuario(req);
  if (b.acao === 'status') {
    const r = await banco('chaves_ia?select=final,criado&user_id=eq.' + u.id);
    return responde(res, 200, { tem: !!(r && r[0]), final: r && r[0] ? r[0].final : '', usaServidor: !(r && r[0]) && u.admin });
  }
  if (b.acao === 'remover') {
    await banco('chaves_ia?user_id=eq.' + u.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return responde(res, 200, { ok: true });
  }
  if (b.acao === 'salvar') {
    const chave = String(b.chave || '').trim();
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(chave)) return responde(res, 400, { erro: 'Essa não parece uma chave da Anthropic. Ela começa com sk-ant-.' });
    const t = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' } });
    if (t.status === 401 || t.status === 403) return responde(res, 400, { erro: 'A Anthropic recusou essa chave. Confira se copiou inteira e se ela está ativa.' });
    if (!t.ok) return responde(res, 502, { erro: 'Não consegui testar a chave agora. Tente de novo em instantes.' });
    await banco('chaves_ia?on_conflict=user_id', { method: 'POST', body: JSON.stringify({ user_id: u.id, provedor: 'anthropic', cifrada: cifra(chave), final: chave.slice(-4), criado: new Date().toISOString() }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    return responde(res, 200, { ok: true, final: chave.slice(-4) });
  }
  // App do Strava da própria pessoa (cada um libera o seu no Strava).
  if (b.acao === 'strava_status') {
    const [a] = await banco('strava_apps?select=client_id&user_id=eq.' + u.id);
    const [t] = await banco('strava_tokens?select=user_id&user_id=eq.' + u.id);
    return responde(res, 200, { app: a ? a.client_id : '', conectado: !!t, padrao: !a && u.admin });
  }
  if (b.acao === 'strava_salvar') {
    const id = String(b.client_id || '').trim(), seg = String(b.client_secret || '').trim();
    if (!/^\d{3,12}$/.test(id)) return responde(res, 400, { erro: 'O Client ID do Strava é só número. Confira na página do seu app.' });
    if (!/^[a-f0-9]{40}$/i.test(seg)) return responde(res, 400, { erro: 'O Client Secret tem 40 letras e números. Toque em "show" na página do app e copie inteiro.' });
    await banco('strava_apps?on_conflict=user_id', { method: 'POST', body: JSON.stringify({ user_id: u.id, client_id: id, segredo: cifra(seg), criado: new Date().toISOString() }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    // A conexão antiga era de outro app e não renova mais.
    await banco('strava_tokens?user_id=eq.' + u.id, { method: 'DELETE', headers: semPref });
    return responde(res, 200, { ok: true });
  }
  if (b.acao === 'strava_remover') {
    await banco('strava_apps?user_id=eq.' + u.id, { method: 'DELETE', headers: semPref });
    await banco('strava_tokens?user_id=eq.' + u.id, { method: 'DELETE', headers: semPref });
    return responde(res, 200, { ok: true });
  }
  responde(res, 400, { erro: 'Ação desconhecida.' });
});
