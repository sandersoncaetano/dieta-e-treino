// Cálculo por IA (refeições, receitas, avaliação do dia, análise das atividades).
// Recebe { prompt, imagens: [{ tipo, base64 }] } e devolve { resultado } com o JSON pedido no prompt.
import { env, responde, corpo, usuario, banco, rota } from './_lib.js';

export const config = { maxDuration: 120 };

function tipoDe(p) {
  if (p.includes('treinador de corrida')) return 'treinador';
  if (p.includes('calculando uma receita')) return 'receita';
  if (p.includes('fechamento do dia')) return 'dia';
  if (p.includes('Analise a atividade atual')) return 'atividade';
  if (p.includes('Analise a semana')) return 'semana';
  if (p.includes('Feche a semana')) return 'fechamento';
  if (p.includes('estimando uma refeição')) return 'refeicao';
  return 'outro';
}

// Modelo e limite de resposta por tipo de chamada. Sonnet para fotos e para o plano do treinador;
// Haiku (cerca de 1/3 do preço) para o que é só texto e curto.
const SONNET = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const HAIKU = process.env.ANTHROPIC_MODEL_LEVE || 'claude-haiku-5-5';
const POR_TIPO = {
  refeicao: { leve: true, max: 1000 },
  receita: { leve: false, max: 2500 },
  dia: { leve: true, max: 900 },
  atividade: { leve: false, max: 1000 },
  semana: { leve: true, max: 500 },
  fechamento: { leve: true, max: 500 },
  treinador: { leve: false, max: 2500 },
  outro: { leve: false, max: 2000 }
};
function escolhe(tipo, temFoto) {
  const c = POR_TIPO[tipo] || POR_TIPO.outro;
  return { modelo: c.leve && !temFoto ? HAIKU : SONNET, max: c.max };
}
// Ferramenta única e obrigatória: a resposta chega como objeto JSON já validado pela API.
const FERRAMENTA = { name: 'responder', description: 'Devolve a resposta no formato JSON pedido no texto.', input_schema: { type: 'object', additionalProperties: true } };

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
  const pedido = await corpo(req);
  // Caso resolvido no próprio app, sem IA: só registra para a tela Uso da IA mostrar a economia.
  if (pedido.local) {
    const t = String(pedido.local);
    if (!['dia', 'atividade', 'refeicao', 'treinador', 'semana', 'fechamento'].includes(t)) return responde(res, 400, { erro: 'Tipo inválido' });
    await banco('uso_ia', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: u.id, tipo: t, modelo: 'local', entrada: 0, saida: 0, imagens: 0 }) });
    return responde(res, 200, { ok: true });
  }
  const { prompt, imagens = [] } = pedido;
  if (!prompt || String(prompt).length > 60000) return responde(res, 400, { erro: 'Prompt inválido' });
  if (imagens.length > 4) return responde(res, 400, { erro: 'Imagens demais' });

  const conteudo = [
    ...imagens.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.tipo || 'image/jpeg', data: i.base64 } })),
    { type: 'text', text: prompt + '\n\nEntregue a resposta chamando a ferramenta responder com o objeto JSON pedido. Dentro dos textos, use aspas simples em vez de aspas duplas.' }
  ];
  const tipo = tipoDe(String(prompt)), esc = escolhe(tipo, imagens.length > 0);

  const chama = async (msgs) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: esc.modelo, max_tokens: esc.max, messages: msgs, tools: [FERRAMENTA], tool_choice: { type: 'tool', name: 'responder' } })
    });
    const j = await r.json();
    if (!r.ok) {
      console.error('Anthropic', r.status, JSON.stringify(j).slice(0, 500));
      throw Object.assign(new Error((j.error && j.error.message) || 'Falha na IA'), { status: 502, code: 'ia' });
    }
    const modelo = j.model || esc.modelo;
    try {
      await banco('uso_ia', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: u.id, tipo, modelo, entrada: (j.usage && j.usage.input_tokens) || 0, saida: (j.usage && j.usage.output_tokens) || 0, imagens: imagens.length }) });
    } catch (e) { /* registro de uso não pode derrubar o cálculo */ }
    const ferr = (j.content || []).filter((c) => c.type === 'tool_use')[0];
    const texto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (!ferr && !texto) console.error('Anthropic sem resposta', JSON.stringify(j).slice(0, 500));
    return { objeto: ferr && ferr.input && typeof ferr.input === 'object' && Object.keys(ferr.input).length ? ferr.input : null, texto, uso: j.usage, parou: j.stop_reason };
  };
  const msgs = [{ role: 'user', content: conteudo }];
  let r1 = await chama(msgs), resultado;
  if (r1.parou === 'max_tokens') console.error('Resposta cortada no limite', tipo, esc.max);
  if (r1.objeto) return responde(res, 200, { resultado: r1.objeto, uso: r1.uso });
  try { resultado = extraiJson(r1.texto); } catch (e) {
    // Sem objeto válido (resposta cortada ou fora do formato): pede uma vez uma versão mais enxuta.
    console.error('Resposta sem JSON', tipo, r1.parou, e.message);
    const r2 = await chama(msgs.concat([
      { role: 'assistant', content: r1.texto || 'Vou responder.' },
      { role: 'user', content: 'A resposta não veio completa. Responda de novo, mais enxuta, chamando a ferramenta responder com o objeto JSON pedido.' }
    ]));
    if (r2.objeto) return responde(res, 200, { resultado: r2.objeto, uso: r2.uso });
    resultado = extraiJson(r2.texto); r1 = r2;
  }
  responde(res, 200, { resultado, uso: r1.uso });
});
