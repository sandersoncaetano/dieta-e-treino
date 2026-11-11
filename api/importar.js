// Importação única dos dados e fotos do artefato do claude.ai. Será removida depois de usada.
// GET /api/importar?token=... (token na variável IMPORT_TOKEN)
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { env, responde, banco, rota } from './_lib.js';

export const config = { maxDuration: 60 };

const TIPOS = { gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export default rota(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!process.env.IMPORT_TOKEN || url.searchParams.get('token') !== process.env.IMPORT_TOKEN) return responde(res, 403, { erro: 'token' });
  const uid = env('IMPORT_USER_ID');
  const raiz = path.join(process.cwd(), 'dados');
  const chave = env('SUPABASE_SERVICE_ROLE_KEY');
  const auth = chave.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + chave };

  // 1. Fotos e GIFs para o Storage
  const arquivos = await readdir(path.join(raiz, 'blobs'));
  const mapa = {};
  const erros = [];
  for (let i = 0; i < arquivos.length; i += 6) {
    await Promise.all(arquivos.slice(i, i + 6).map(async (f) => {
      const [id, ext] = f.split('.');
      const destino = uid + '/antigo-' + id + '.' + ext;
      const corpo = await readFile(path.join(raiz, 'blobs', f));
      const r = await fetch(env('SUPABASE_URL') + '/storage/v1/object/fotos/' + destino, {
        method: 'POST',
        headers: { apikey: chave, ...auth, 'Content-Type': TIPOS[ext] || 'application/octet-stream', 'x-upsert': 'true' },
        body: corpo
      });
      if (!r.ok) { erros.push(f + ': ' + (await r.text()).slice(0, 200)); return; }
      mapa[id] = { url: env('SUPABASE_URL') + '/storage/v1/object/public/fotos/' + destino, caminho: destino };
    }));
  }

  // 2. Registros, trocando os endereços /_blob/<id> pelos novos
  const backup = JSON.parse(await readFile(path.join(raiz, 'backup.json'), 'utf8'));
  const linhas = [];
  for (const [colecao, docs] of Object.entries(backup.colecoes)) {
    for (const [id, data] of Object.entries(docs)) {
      let txt = JSON.stringify(data);
      txt = txt.replace(/\/_blob\/([0-9a-f]{32})/g, (m, a) => (mapa[a] ? mapa[a].url : m));
      const novo = JSON.parse(txt);
      (function troca(o) {
        if (!o || typeof o !== 'object') return;
        for (const k of Object.keys(o)) {
          if (k === 'asset_id' && typeof o[k] === 'string' && mapa[o[k]]) o[k] = mapa[o[k]].caminho;
          else troca(o[k]);
        }
      })(novo);
      linhas.push({ user_id: uid, colecao, id, data: novo, atualizado: new Date().toISOString() });
    }
  }
  for (let i = 0; i < linhas.length; i += 200) {
    await banco('docs', { method: 'POST', body: JSON.stringify(linhas.slice(i, i + 200)), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  }
  const porColecao = {};
  linhas.forEach((l) => { porColecao[l.colecao] = (porColecao[l.colecao] || 0) + 1; });
  responde(res, 200, { fotos: Object.keys(mapa).length, de: arquivos.length, erros, registros: porColecao });
});
