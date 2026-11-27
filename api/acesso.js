// Pedido de acesso e aprovação de pessoas.
//  POST {acao:'pedir', nome, email, senha, indicado}  (sem login) → cria a conta como "pendente" e avisa o administrador
//  POST {acao:'lista'}                                 (administrador) → perfis
//  POST {acao:'status', user_id, status}               (administrador) → aprova, recusa, bloqueia ou reativa
import webpush from 'web-push';
import { env, responde, corpo, usuario, banco, rota } from './_lib.js';

const enc = encodeURIComponent;
const STATUS = new Set(['pendente', 'aprovado', 'recusado', 'bloqueado']);

async function authAdmin(caminho, opcoes = {}) {
  const chave = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(env('SUPABASE_URL') + '/auth/v1/admin/' + caminho, {
    ...opcoes,
    headers: { apikey: chave, ...(chave.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + chave }), 'Content-Type': 'application/json' }
  });
  const txt = await r.text();
  let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = {}; }
  if (!r.ok) throw Object.assign(new Error(j.msg || j.message || j.error_description || 'Falha ao criar a conta'), { status: r.status === 422 ? 409 : 500, code: j.error_code || 'auth' });
  return j;
}

async function avisaAdmins(titulo, texto) {
  if (!process.env.VAPID_PUBLIC || !process.env.VAPID_PRIVATE) return;
  const admins = await banco('perfis?select=user_id,email&admin=eq.true&status=eq.aprovado');
  if (!admins || !admins.length) return;
  webpush.setVapidDetails('mailto:' + admins[0].email, env('VAPID_PUBLIC'), env('VAPID_PRIVATE'));
  const msg = JSON.stringify({ titulo, corpo: texto, tag: 'acesso' });
  for (const a of admins) {
    const subs = await banco('push_inscricoes?select=endpoint,p256dh,auth&user_id=eq.' + a.user_id);
    await Promise.all((subs || []).map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, msg, { TTL: 86400 }).catch(() => {})));
  }
}

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responde(res, 405, { erro: 'Use POST' });
  const b = await corpo(req);

  if (b.acao === 'pedir') {
    const email = String(b.email || '').trim().toLowerCase();
    const nome = String(b.nome || '').trim().slice(0, 80);
    const senha = String(b.senha || '');
    const indicado = String(b.indicado || '').trim().slice(0, 80) || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responde(res, 400, { erro: 'E-mail inválido.' });
    if (nome.length < 2) return responde(res, 400, { erro: 'Informe seu nome.' });
    if (senha.length < 8) return responde(res, 400, { erro: 'A senha precisa ter pelo menos 8 caracteres.' });
    const ja = await banco('perfis?select=status&email=eq.' + enc(email));
    if (ja && ja[0]) return responde(res, 200, { ok: true, status: ja[0].status, ja: true });
    const pend = await banco('perfis?select=user_id&status=eq.pendente');
    if (pend && pend.length >= 30) return responde(res, 429, { erro: 'Muitos pedidos aguardando aprovação. Tente de novo mais tarde.' });
    const u = await authAdmin('users', { method: 'POST', body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { nome } }) });
    await banco('perfis', { method: 'POST', body: JSON.stringify({ user_id: u.id, email, nome, indicado_por: indicado, status: 'pendente' }), headers: { Prefer: 'return=minimal' } });
    await avisaAdmins('Novo pedido de acesso', nome + ' (' + email + ')' + (indicado ? ', indicado por ' + indicado : '')).catch(() => {});
    return responde(res, 200, { ok: true, status: 'pendente' });
  }

  const u = await usuario(req);
  if (!u.admin) return responde(res, 403, { erro: 'Só o administrador pode fazer isso.' });

  if (b.acao === 'lista') {
    const ps = await banco('perfis?select=user_id,email,nome,status,admin,indicado_por,criado,aprovado_em&order=criado.desc');
    return responde(res, 200, { perfis: ps || [] });
  }

  if (b.acao === 'status') {
    const id = String(b.user_id || ''), st = String(b.status || '');
    if (!STATUS.has(st)) return responde(res, 400, { erro: 'Status inválido.' });
    if (id === u.id) return responde(res, 400, { erro: 'Você não pode mudar o seu próprio acesso.' });
    const patch = { status: st, ...(st === 'aprovado' ? { aprovado_em: new Date().toISOString() } : {}) };
    const r = await banco('perfis?user_id=eq.' + enc(id), { method: 'PATCH', body: JSON.stringify(patch) });
    return responde(res, 200, { ok: true, perfil: r && r[0] });
  }

  responde(res, 400, { erro: 'Ação desconhecida.' });
});
