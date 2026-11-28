// Sugestões de exercício para a base de todos. A IA de quem sugere faz a triagem; o administrador aprova.
//  POST {acao:'enviar', tipo, dados, triagem}   → guarda como pendente e avisa o administrador
//  POST {acao:'minhas'}                          → sugestões da pessoa
//  POST {acao:'base'}                            → exercícios aprovados (para a busca de todos)
//  POST {acao:'lista'}                           (administrador) → pendentes
//  POST {acao:'decidir', id, status, dados?, nota?} (administrador) → aprova ou recusa
import { responde, corpo, usuario, banco, rota, avisaAdmins } from './_lib.js';

const enc = encodeURIComponent;
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
function limpa(d) {
  d = d || {};
  return {
    nome: txt(d.nome, 60),
    g: (Array.isArray(d.g) ? d.g : String(d.g || '').split(',')).map((x) => txt(x, 30)).filter(Boolean).slice(0, 6),
    eq: txt(d.eq, 30),
    how: txt(d.how, 800),
    dica: txt(d.dica, 300)
  };
}

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responde(res, 405, { erro: 'Use POST' });
  const b = await corpo(req);
  const u = await usuario(req);

  if (b.acao === 'base') {
    const r = await banco('contribuicoes?select=id,tipo,dados&status=eq.aprovado&order=revisado_em.desc&limit=2000');
    return responde(res, 200, { ex: r || [] });
  }
  // GIFs do Peleja (feitos na Fábrica de GIFs): valem para todo mundo.
  if (b.acao === 'gifs') {
    const r = await banco('gifs_base?select=exercicio_id,nome,url&limit=5000');
    return responde(res, 200, { gifs: r || [] });
  }
  if (b.acao === 'minhas') {
    const r = await banco('contribuicoes?select=id,tipo,dados,status,nota,criado&user_id=eq.' + u.id + '&order=criado.desc&limit=100');
    return responde(res, 200, { lista: r || [] });
  }
  if (b.acao === 'enviar') {
    const d = limpa(b.dados), tipo = b.tipo === 'pilates' ? 'pilates' : 'academia';
    if (d.nome.length < 3) return responde(res, 400, { erro: 'Dê um nome ao exercício.' });
    if (d.how.length < 20) return responde(res, 400, { erro: 'Descreva como fazer, em uma ou duas frases.' });
    const pend = await banco('contribuicoes?select=id&status=eq.pendente&user_id=eq.' + u.id);
    if (pend && pend.length >= 20) return responde(res, 400, { erro: 'Você já tem 20 sugestões esperando aprovação.' });
    const tri = b.triagem && typeof b.triagem === 'object' ? JSON.parse(JSON.stringify(b.triagem).slice(0, 4000)) : null;
    await banco('contribuicoes', { method: 'POST', body: JSON.stringify({ user_id: u.id, tipo, dados: d, triagem: tri }), headers: { Prefer: 'return=minimal' } });
    const p = await banco('perfis?select=nome&user_id=eq.' + u.id);
    await avisaAdmins('Exercício sugerido', ((p && p[0] && p[0].nome) || 'Alguém') + ' sugeriu: ' + d.nome + '.').catch(() => {});
    return responde(res, 200, { ok: true });
  }

  if (!u.admin) return responde(res, 403, { erro: 'Só o administrador pode fazer isso.' });

  if (b.acao === 'gif_publicar') {
    const id = txt(b.id, 80), url = String(b.url || '');
    if (!id || !/^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/fotos\//.test(url)) return responde(res, 400, { erro: 'Dados inválidos.' });
    await banco('gifs_base?on_conflict=exercicio_id', { method: 'POST', body: JSON.stringify({ exercicio_id: id, nome: txt(b.nome, 80) || id, url, caminho: txt(b.caminho, 200) || null, criado: new Date().toISOString() }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    return responde(res, 200, { ok: true });
  }
  if (b.acao === 'gif_remover') {
    await banco('gifs_base?exercicio_id=eq.' + enc(txt(b.id, 80)), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return responde(res, 200, { ok: true });
  }
  if (b.acao === 'lista') {
    const r = await banco('contribuicoes?select=id,user_id,tipo,dados,triagem,status,criado&status=eq.pendente&order=criado.asc&limit=200');
    const ids = [...new Set((r || []).map((x) => x.user_id))];
    const ps = ids.length ? await banco('perfis?select=user_id,nome&user_id=in.(' + ids.map(enc).join(',') + ')') : [];
    const nome = {}; (ps || []).forEach((p) => { nome[p.user_id] = p.nome; });
    return responde(res, 200, { lista: (r || []).map((x) => ({ ...x, quem: nome[x.user_id] || '' })) });
  }
  if (b.acao === 'decidir') {
    const st = b.status === 'aprovado' ? 'aprovado' : b.status === 'recusado' ? 'recusado' : null;
    if (!st) return responde(res, 400, { erro: 'Status inválido.' });
    const patch = { status: st, revisado_em: new Date().toISOString(), nota: txt(b.nota, 300) || null };
    if (b.dados) patch.dados = limpa(b.dados);
    await banco('contribuicoes?id=eq.' + enc(String(b.id || '')), { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
    return responde(res, 200, { ok: true });
  }
  responde(res, 400, { erro: 'Ação desconhecida.' });
});
