// Funções comuns das rotas do servidor (Vercel). Arquivos com "_" não viram rota.
import crypto from 'node:crypto';

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
  const permitidos = env('EMAILS_PERMITIDOS').split(',').map((s) => s.trim().toLowerCase());
  if (!permitidos.includes(String(u.email || '').toLowerCase())) throw Object.assign(new Error('Usuário não autorizado'), { status: 403, code: 'nao_autorizado' });
  return u;
}

// Acesso ao banco com a chave de serviço (só no servidor).
export async function banco(caminho, opcoes = {}) {
  const r = await fetch(env('SUPABASE_URL') + '/rest/v1/' + caminho, {
    ...opcoes,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'),
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
      responde(res, e.status || 500, { erro: e.message || 'Erro', code: e.code || 'erro' });
    }
  };
}
