// Importa o backup do artefato (backup/dieta-e-treino-dados.json) para o Supabase.
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... USER_ID=<uuid do seu usuário> \
//   node scripts/importar-backup.mjs caminho/dieta-e-treino-dados.json
import { readFile } from 'node:fs/promises';

const [arquivo] = process.argv.slice(2);
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, USER_ID } = process.env;
if (!arquivo || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !USER_ID) {
  console.error('Informe o arquivo e as variáveis SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e USER_ID.');
  process.exit(1);
}

const backup = JSON.parse(await readFile(arquivo, 'utf8'));
const linhas = [];
for (const [colecao, docs] of Object.entries(backup.colecoes || {})) {
  for (const [id, data] of Object.entries(docs)) linhas.push({ user_id: USER_ID, colecao, id, data, atualizado: new Date().toISOString() });
}

for (let i = 0; i < linhas.length; i += 500) {
  const lote = linhas.slice(i, i + 500);
  const r = await fetch(SUPABASE_URL + '/rest/v1/docs', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      ...(SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY }),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(lote)
  });
  if (!r.ok) { console.error('Falhou no lote', i, await r.text()); process.exit(1); }
  console.log('Importados', Math.min(i + 500, linhas.length), 'de', linhas.length);
}

const porColecao = {};
linhas.forEach((l) => { porColecao[l.colecao] = (porColecao[l.colecao] || 0) + 1; });
console.log('Pronto:', porColecao);
console.log('Atenção: fotos que apontam para o claude.ai precisam ser copiadas à parte (veja o README).');
