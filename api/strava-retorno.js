// Retorno do Strava depois da autorização: troca o código pelos tokens e guarda no banco.
import { env, banco, confere, rota } from './_lib.js';

export default rota(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const uid = confere(url.searchParams.get('state'));
  const code = url.searchParams.get('code');
  const base = env('APP_URL').replace(/\/$/, '');
  if (!uid || !code) { res.writeHead(302, { Location: base + '/?strava=erro#historico' }); return res.end(); }
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env('STRAVA_CLIENT_ID'), client_secret: env('STRAVA_CLIENT_SECRET'), code, grant_type: 'authorization_code' })
  });
  const t = await r.json();
  if (!r.ok) { res.writeHead(302, { Location: base + '/?strava=erro#historico' }); return res.end(); }
  await banco('strava_tokens', {
    method: 'POST',
    body: JSON.stringify({ user_id: uid, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, athlete_id: t.athlete && t.athlete.id })
  });
  res.writeHead(302, { Location: base + '/?strava=ok#historico' });
  res.end();
});
