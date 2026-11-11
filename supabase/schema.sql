-- Dieta e Treino: estrutura do banco no Supabase.
-- Rode tudo no SQL Editor do projeto, uma vez.

-- 1. Documentos do app. Cada linha é um registro de uma coleção
--    (treinos, refeicoes, peso, medidas, strava, analises etc.), igual ao banco do artefato.
create table if not exists public.docs (
  user_id    uuid not null references auth.users (id) on delete cascade,
  colecao    text not null,
  id         text not null,
  data       jsonb not null,
  atualizado timestamptz not null default now(),
  primary key (user_id, colecao, id)
);
create index if not exists docs_colecao on public.docs (user_id, colecao);

alter table public.docs enable row level security;
drop policy if exists "dono le" on public.docs;
drop policy if exists "dono grava" on public.docs;
create policy "dono le" on public.docs for select using (auth.uid() = user_id);
create policy "dono grava" on public.docs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Atualização em tempo real entre celular e notebook.
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 2. Tokens do Strava. Só o servidor acessa (chave de serviço); a página não lê.
create table if not exists public.strava_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    bigint not null,
  athlete_id    bigint
);
alter table public.strava_tokens enable row level security;

-- 3. Calorias por atividade (a lista do Strava não traz calorias; o detalhe traz).
create table if not exists public.strava_cache (
  user_id     uuid not null references auth.users (id) on delete cascade,
  activity_id text not null,
  calorias    integer,
  primary key (user_id, activity_id)
);
alter table public.strava_cache enable row level security;

-- 4. Fotos (refeições, receitas, GIFs dos exercícios).
--    Bucket público: os endereços têm nomes aleatórios e não são listáveis por terceiros.
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do nothing;

drop policy if exists "fotos dono envia" on storage.objects;
drop policy if exists "fotos dono apaga" on storage.objects;
create policy "fotos dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
