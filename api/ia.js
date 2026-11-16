// Cálculo por IA (refeições, receitas, avaliação do dia, análise das atividades).
// Recebe { prompt, imagens: [{ tipo, base64 }] } e devolve { resultado } com o JSON pedido no prompt.
import { env, responde, corpo, usuario, banco, rota } from './_lib.js';

export const config = { maxDuration: 120 };

function tipoDe(p) {
  if (p.includes('calculando uma receita')) return 'receita';
  if (p.includes('fechamento do dia')) return 'dia';
  if (p.includes('Analise a atividade atual')) return 'atividade';
  if (p.includes('Analise a semana')) return 'semana';
  if (p.includes('Feche a semana')) return 'fechamento';
  if (p.includes('treinador de corrida')) return 'treinador';
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
    { type: 'text', text: prompt + '\n\nResponda somente com o JSON, sem texto antes ou depois. Dentro dos textos, use aspas simples em vez de aspas duplas.' }
  ];

  const chama = async (msgs) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 6000, messages: msgs })
    });
    const j = await r.json();
    if (!r.ok) {
      console.error('Anthropic', r.status, JSON.stringify(j).slice(0, 500));
      throw Object.assign(new Error((j.error && j.error.message) || 'Falha na IA'), { status: 502, code: 'ia' });
    }
    const modelo = j.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
    try {
      await banco('uso_ia', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: u.id, tipo: tipoDe(String(prompt)), modelo, entrada: (j.usage && j.usage.input_tokens) || 0, saida: (j.usage && j.usage.output_tokens) || 0, imagens: imagens.length }) });
    } catch (e) { /* registro de uso não pode derrubar o cálculo */ }
    const texto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (!texto) console.error('Anthropic sem texto', JSON.stringify(j).slice(0, 500));
    return { texto, uso: j.usage, parou: j.stop_reason };
  };
  const msgs = [{ role: 'user', content: conteudo }];
  let r1 = await chama(msgs), resultado;
  try { resultado = extraiJson(r1.texto); } catch (e) {
    // JSON inválido (aspas soltas, texto cortado): pede uma vez para a IA corrigir.
    console.error('JSON inválido', r1.parou, e.message);
    const r2 = await chama(msgs.concat([
      { role: 'assistant', content: r1.texto || '{}' },
      { role: 'user', content: 'Esse JSON está inválido (' + e.message + '). Devolva o mesmo conteúdo como JSON válido, mais enxuto se precisar, sem aspas duplas dentro dos textos. Só o JSON.' }
    ]));
    resultado = extraiJson(r2.texto); r1 = r2;
  }
  responde(res, 200, { resultado, uso: r1.uso });
});
