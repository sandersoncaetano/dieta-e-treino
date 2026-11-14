// Última cotação do dólar no Brasil (venda). Fonte principal: AwesomeAPI; reserva: PTAX do Banco Central.
import { responde, rota } from './_lib.js';

async function awesome() {
  const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('awesomeapi ' + r.status);
  const j = await r.json(), x = j && j.USDBRL;
  const v = Number(x && x.ask);
  if (!v) throw new Error('awesomeapi sem valor');
  return { valor: v, quando: new Date(Number(x.timestamp) * 1000).toISOString(), fonte: 'AwesomeAPI' };
}

async function ptax() {
  // Procura o último dia útil com PTAX nos últimos 7 dias.
  const fmt = (d) => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '-' + d.getFullYear();
  const fim = new Date(), ini = new Date(Date.now() - 7 * 864e5);
  const url = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)?@i='" + fmt(ini) + "'&@f='" + fmt(fim) + "'&$format=json&$orderby=dataHoraCotacao%20desc&$top=1";
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('ptax ' + r.status);
  const j = await r.json(), x = j && j.value && j.value[0];
  if (!x || !x.cotacaoVenda) throw new Error('ptax sem valor');
  return { valor: Number(x.cotacaoVenda), quando: new Date(x.dataHoraCotacao.replace(' ', 'T') + '-03:00').toISOString(), fonte: 'PTAX do Banco Central' };
}

export default rota(async (req, res) => {
  let c = null;
  try { c = await awesome(); } catch (e) { console.error('cotacao', e.message); }
  if (!c) { try { c = await ptax(); } catch (e) { console.error('cotacao', e.message); } }
  if (!c && Number(process.env.COTACAO_DOLAR)) c = { valor: Number(process.env.COTACAO_DOLAR), quando: null, fonte: 'valor fixo do app' };
  if (!c) return responde(res, 503, { erro: 'Cotação indisponível agora' });
  // Guarda na borda do Vercel por 30 minutos.
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  responde(res, 200, c);
});
