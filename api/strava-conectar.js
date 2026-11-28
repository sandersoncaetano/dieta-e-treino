// Gera o link de autorização do Strava para o usuário logado.
import { env, responde, usuario, assina, rota, stravaApp } from './_lib.js';

export default rota(async (req, res) => {
  const u = await usuario(req);
  const app = await stravaApp(u.id);
  if (!app) return responde(res, 409, { erro: 'Cadastre o seu app do Strava primeiro.', code: 'sem_app_strava' });
  const base = env('APP_URL').replace(/\/$/, '');
  const q = new URLSearchParams({
    client_id: app.id,
    response_type: 'code',
    redirect_uri: base + '/api/strava-retorno',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all,profile:read_all',
    state: assina(u.id)
  });
  responde(res, 200, { url: 'https://www.strava.com/oauth/authorize?' + q });
});
