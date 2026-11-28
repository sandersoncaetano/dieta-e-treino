// Pedido de acesso e aprovação de pessoas.
//  POST {acao:'convite', codigo}                       (sem login) → confere o convite
//  POST {acao:'aceitar', codigo, nome, email, senha}    (sem login) → cria a conta já aprovada e avisa o administrador
//  POST {acao:'convidar', nome?, email?}                (administrador) → cria um convite (vale 14 dias)
//  POST {acao:'cancelar', codigo}                       (administrador) → cancela um convite
//  POST {acao:'lista'}                                 (administrador) → perfis
//  POST {acao:'status', user_id, status}               (administrador) → aprova, recusa, bloqueia ou reativa
//  POST {acao:'senha', user_id}                         (administrador) → gera uma senha provisória e devolve para você repassar
import crypto from 'node:crypto';
import { env, responde, corpo, usuario, banco, rota, avisaAdmins } from './_lib.js';

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

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responde(res, 405, { erro: 'Use POST' });
  const b = await corpo(req);

  // Convite: só entra quem recebeu um link seu. A conta nasce aprovada.
  async function conviteValido(codigo) {
    const c = /^[a-z0-9]{6,16}$/.test(codigo) ? await banco('convites?select=*&codigo=eq.' + enc(codigo)) : null;
    const v = c && c[0];
    if (!v || v.cancelado) return { erro: 'Convite inválido. Peça um novo link a quem te convidou.' };
    if (v.usado_por) return { erro: 'Este convite já foi usado. Se a conta é sua, entre com e-mail e senha.' };
    if (new Date(v.expira) < new Date()) return { erro: 'Este convite venceu. Peça um novo link a quem te convidou.' };
    return { v };
  }

  if (b.acao === 'convite') {
    const r = await conviteValido(String(b.codigo || ''));
    if (r.erro) return responde(res, 400, { erro: r.erro });
    return responde(res, 200, { ok: true, nome: r.v.nome || '', email: r.v.email || '' });
  }

  if (b.acao === 'aceitar') {
    const r = await conviteValido(String(b.codigo || ''));
    if (r.erro) return responde(res, 400, { erro: r.erro });
    const email = String(b.email || '').trim().toLowerCase();
    const nome = String(b.nome || '').trim().slice(0, 80);
    const senha = String(b.senha || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responde(res, 400, { erro: 'E-mail inválido.' });
    if (r.v.email && r.v.email !== email) return responde(res, 400, { erro: 'Este convite é para outro e-mail.' });
    if (nome.length < 2) return responde(res, 400, { erro: 'Informe seu nome.' });
    if (senha.length < 8) return responde(res, 400, { erro: 'A senha precisa ter pelo menos 8 caracteres.' });
    const ja = await banco('perfis?select=status&email=eq.' + enc(email));
    if (ja && ja[0]) return responde(res, 400, { erro: 'Já existe uma conta com este e-mail. Entre com e-mail e senha.' });
    const u = await authAdmin('users', { method: 'POST', body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { nome } }) });
    const quem = r.v.criado_por ? await banco('perfis?select=nome&user_id=eq.' + r.v.criado_por) : null;
    await banco('perfis', { method: 'POST', body: JSON.stringify({ user_id: u.id, email, nome, indicado_por: (quem && quem[0] && quem[0].nome) || null, status: 'aprovado', aprovado_em: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
    await banco('convites?codigo=eq.' + enc(r.v.codigo), { method: 'PATCH', body: JSON.stringify({ usado_por: u.id, usado_em: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
    await avisaAdmins('Convite aceito', nome + ' (' + email + ') criou a conta.').catch(() => {});
    return responde(res, 200, { ok: true });
  }

  const u = await usuario(req);
  if (!u.admin) return responde(res, 403, { erro: 'Só o administrador pode fazer isso.' });

  if (b.acao === 'lista') {
    const ps = await banco('perfis?select=user_id,email,nome,status,admin,indicado_por,criado,aprovado_em&order=criado.desc');
    const cs = await banco('convites?select=codigo,nome,email,criado,expira&usado_por=is.null&cancelado=eq.false&expira=gt.' + enc(new Date().toISOString()) + '&order=criado.desc');
    return responde(res, 200, { perfis: ps || [], convites: cs || [] });
  }

  if (b.acao === 'convidar') {
    const nome = String(b.nome || '').trim().slice(0, 80) || null;
    const email = String(b.email || '').trim().toLowerCase() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responde(res, 400, { erro: 'E-mail inválido.' });
    const ABC = 'abcdefghjkmnpqrstuvwxyz23456789', codigo = Array.from(crypto.randomBytes(10), (x) => ABC[x % ABC.length]).join('');
    await banco('convites', { method: 'POST', body: JSON.stringify({ codigo, nome, email, criado_por: u.id }), headers: { Prefer: 'return=minimal' } });
    return responde(res, 200, { ok: true, codigo });
  }

  if (b.acao === 'cancelar') {
    await banco('convites?codigo=eq.' + enc(String(b.codigo || '')), { method: 'PATCH', body: JSON.stringify({ cancelado: true }), headers: { Prefer: 'return=minimal' } });
    return responde(res, 200, { ok: true });
  }

  if (b.acao === 'status') {
    const id = String(b.user_id || ''), st = String(b.status || '');
    if (!STATUS.has(st)) return responde(res, 400, { erro: 'Status inválido.' });
    if (id === u.id) return responde(res, 400, { erro: 'Você não pode mudar o seu próprio acesso.' });
    const patch = { status: st, ...(st === 'aprovado' ? { aprovado_em: new Date().toISOString() } : {}) };
    const r = await banco('perfis?user_id=eq.' + enc(id), { method: 'PATCH', body: JSON.stringify(patch) });
    return responde(res, 200, { ok: true, perfil: r && r[0] });
  }

  if (b.acao === 'senha') {
    const id = String(b.user_id || '');
    if (!id || id === u.id) return responde(res, 400, { erro: 'Escolha outra pessoa.' });
    // Sem letras e números que se confundem (0/O, 1/l), para ditar ou mandar por mensagem.
    const ABC = 'abcdefghjkmnpqrstuvwxyz23456789', bytes = crypto.randomBytes(10);
    const senha = Array.from(bytes, (x) => ABC[x % ABC.length]).join('');
    await authAdmin('users/' + enc(id), { method: 'PUT', body: JSON.stringify({ password: senha }) });
    return responde(res, 200, { ok: true, senha });
  }

  responde(res, 400, { erro: 'Ação desconhecida.' });
});
