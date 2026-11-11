// Cálculo por IA (refeições, receitas, avaliação do dia, análise das atividades).
// Recebe { prompt, imagens: [{ tipo, base64 }] } e devolve { resultado } com o JSON pedido no prompt.
import { env, responde, corpo, usuario, banco, rota } from './_lib.js';

export const config = { maxDuration: 60 };

function tipoDe(p) {
  if (p.includes('calculando uma receita')) return 'receita';
  if (p.includes('fechamento do dia')) return 'dia';
  if (p.includes('Analise a atividade atual')) return 'atividade';
  if (p.includes('estimando uma refeição')) return 'refeicao';
  return 'outro';
}

function extraiJson(txt) {
  const t = String(txt || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw Object.assign(new Error('A IA não devolveu JSON'), { status: 502, code: 'formato' });
}

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responde(res, 405, { erro: 'Use POST' });
  const u = await usuario(req);
  const { prompt, imagens = [] } = await corpo(req);
  if (!prompt || String(prompt).length > 60000) return responde(res, 400, { erro: 'Prompt inválido' });
  if (imagens.length > 4) return responde(res, 400, { erro: 'Imagens demais' });

  const conteudo = [
    ...imagens.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.tipo || 'image/jpeg', data: i.base64 } })),
    { type: 'text', text: prompt + '\n\nResponda somente com o JSON, sem texto antes ou depois.' }
  ];

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: conteudo }]
    })
  });
  const j = await r.json();
  if (!r.ok) {
    console.error('Anthropic', r.status, JSON.stringify(j).slice(0, 500));
    return responde(res, 502, { erro: (j.error && j.error.message) || 'Falha na IA', code: 'ia' });
  }
  const modelo = j.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  try {
    await banco('uso_ia', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: u.id, tipo: tipoDe(String(prompt)), modelo, entrada: (j.usage && j.usage.input_tokens) || 0, saida: (j.usage && j.usage.output_tokens) || 0, imagens: imagens.length }) });
  } catch (e) { /* registro de uso não pode derrubar o cálculo */ }
  const texto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (!texto) console.error('Anthropic sem texto', JSON.stringify(j).slice(0, 500));
  responde(res, 200, { resultado: extraiJson(texto), uso: j.usage });
});
