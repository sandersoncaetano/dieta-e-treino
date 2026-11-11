// Gera o link de autorização do Strava para o usuário logado.
import { env, responde, usuario, assina, rota } from './_lib.js';

export default rota(async (req, res) => {
  const u = await usuario(req);
  const base = env('APP_URL').replace(/\/$/, '');
  const q = new URLSearchParams({
    client_id: env('STRAVA_CLIENT_ID'),
    response_type: 'code',
    redirect_uri: base + '/api/strava-retorno',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: assina(u.id)
  });
  responde(res, 200, { url: 'https://www.strava.com/oauth/authorize?' + q });
});
