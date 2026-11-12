// Endereço e chave pública do Supabase para a página. A chave anon é pública por natureza;
// quem protege os dados são as regras de acesso (RLS) do banco.
import { env, responde, rota } from './_lib.js';

export default rota(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  responde(res, 200, {
    supabaseUrl: env('SUPABASE_URL'), supabaseAnonKey: env('SUPABASE_ANON_KEY'),
    // Preço por milhão de tokens em US$, para a estimativa de custo. Confira em anthropic.com/pricing e ajuste no Vercel.
    precoEntrada: Number(process.env.PRECO_ENTRADA_MTOK || 3), precoSaida: Number(process.env.PRECO_SAIDA_MTOK || 15),
    cotacaoDolar: Number(process.env.COTACAO_DOLAR || 0) || null,
    vapidPublic: process.env.VAPID_PUBLIC || null
  });
});
