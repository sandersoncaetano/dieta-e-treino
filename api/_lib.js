// Funções comuns das rotas do servidor (Vercel). Arquivos com "_" não viram rota.
import crypto from 'node:crypto';
import webpush from 'web-push';

export const env = (k) => {
  const v = process.env[k];
  if (!v) throw Object.assign(new Error('Variável de ambiente ausente: ' + k), { status: 500 });
  return v;
};

export function responde(res, status, corpo) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(corpo));
}

export async function corpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const partes = [];
  for await (const p of req) partes.push(p);
  const txt = Buffer.concat(partes).toString('utf8');
  return txt ? JSON.parse(txt) : {};
}

// Confere o token do Supabase e o e-mail autorizado. Devolve o usuário.
export async function usuario(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw Object.assign(new Error('Sem login'), { status: 401, code: 'sem_login' });
  const r = await fetch(env('SUPABASE_URL') + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + token, apikey: env('SUPABASE_ANON_KEY') }
  });
  if (!r.ok) throw Object.assign(new Error('Login expirado'), { status: 401, code: 'sem_login' });
  const u = await r.json();
  // Acesso: perfil aprovado na tabela perfis; a lista EMAILS_PERMITIDOS continua valendo como reserva.
  let perfil = null;
  try { const p = await banco('perfis?select=status,admin&user_id=eq.' + u.id); perfil = p && p[0]; } catch (e) { perfil = null; }
  const permitidos = (process.env.EMAILS_PERMITIDOS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const naLista = permitidos.includes(String(u.email || '').toLowerCase());
  if (!(perfil && perfil.status === 'aprovado') && !naLista) throw Object.assign(new Error('Usuário não autorizado'), { status: 403, code: 'nao_autorizado' });
  u.admin = !!(perfil && perfil.admin && perfil.status === 'aprovado');
  return u;
}

// Acesso ao banco com a chave de serviço (só no servidor).
export async function banco(caminho, opcoes = {}) {
  const r = await fetch(env('SUPABASE_URL') + '/rest/v1/' + caminho, {
    ...opcoes,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      // Chaves novas (sb_secret_...) vão só no apikey; as antigas (JWT) também no Authorization.
      ...(env('SUPABASE_SERVICE_ROLE_KEY').startsWith('sb_') ? {} : { Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY') }),
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
      ...(opcoes.headers || {})
    }
  });
  const txt = await r.text();
  if (!r.ok) throw Object.assign(new Error('Banco: ' + txt), { status: 500 });
  return txt ? JSON.parse(txt) : null;
}

// Assinatura simples para o "state" do OAuth do Strava.
export function assina(valor) {
  const h = crypto.createHmac('sha256', env('STRAVA_CLIENT_SECRET')).update(valor).digest('base64url');
  return valor + '.' + h;
}
export function confere(assinado) {
  const i = String(assinado || '').lastIndexOf('.');
  if (i < 1) return null;
  const valor = assinado.slice(0, i);
  return assina(valor) === assinado ? valor : null;
}

export function rota(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(req.url, e.status || 500, e.code || '', e.message);
      responde(res, e.status || 500, { erro: e.message || 'Erro', code: e.code || 'erro' });
    }
  };
}

// Notificação para os administradores (convites aceitos, sugestões de exercício).
export async function avisaAdmins(titulo, texto) {
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

// Chave de IA de cada pessoa: cifrada (AES-256-GCM) antes de ir para o banco.
function segredoChaves() {
  const base = process.env.CHAVE_IA_SEGREDO || env('SUPABASE_SERVICE_ROLE_KEY');
  return Buffer.from(crypto.hkdfSync('sha256', base, 'peleja', 'chave-ia', 32));
}
export function cifra(txt) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', segredoChaves(), iv);
  const dados = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString('base64')).join('.');
}
export function decifra(s) {
  const [iv, tag, dados] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', segredoChaves(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString('utf8');
}
// Chave que vale para a pessoa: a dela; sem ela, a do servidor só para o administrador.
export async function chaveDe(u) {
  const r = await banco('chaves_ia?select=cifrada&user_id=eq.' + u.id);
  if (r && r[0]) { try { return { chave: decifra(r[0].cifrada), propria: true }; } catch (e) { console.error('chave ilegível', u.id); } }
  if (u.admin) return { chave: env('ANTHROPIC_API_KEY'), propria: false };
  return null;
}
