// Retorno do Strava depois da autorização: troca o código pelos tokens e guarda no banco.
import { env, banco, confere, rota, stravaApp } from './_lib.js';

export default rota(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const uid = confere(url.searchParams.get('state'));
  const code = url.searchParams.get('code');
  const base = env('APP_URL').replace(/\/$/, '');
  if (!uid || !code) { res.writeHead(302, { Location: base + '/?strava=erro#historico' }); return res.end(); }
  const app = await stravaApp(uid);
  if (!app) { res.writeHead(302, { Location: base + '/?strava=semapp#historico' }); return res.end(); }
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: app.id, client_secret: app.segredo, code, grant_type: 'authorization_code' })
  });
  const t = await r.json();
  if (!r.ok) {
    // Com o app do Strava ainda limitado a poucos atletas, o Strava recusa quem passa do limite.
    const limite = /limit|capacity|exceeded/i.test(JSON.stringify(t || {}));
    console.error('Strava recusou', r.status, JSON.stringify(t).slice(0, 300));
    res.writeHead(302, { Location: base + '/?strava=' + (limite ? 'limite' : 'erro') + '#historico' }); return res.end();
  }
  await banco('strava_tokens', {
    method: 'POST',
    body: JSON.stringify({ user_id: uid, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, athlete_id: t.athlete && (t.athlete.id_str || t.athlete.id) })
  });
  res.writeHead(302, { Location: base + '/?strava=ok#historico' });
  res.end();
});
