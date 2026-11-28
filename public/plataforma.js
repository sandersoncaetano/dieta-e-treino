/*
  Plataforma própria do Peleja (antigo Dieta e Treino).
  Substitui os serviços que o claude.ai fornecia ao artefato (window.claude.use):
    db     -> tabela "docs" no Supabase, com atualização em tempo real
    assets -> bucket "fotos" no Supabase Storage
    sample -> /api/ia (API da Anthropic no servidor)
    mcp    -> /api/strava (API do Strava no servidor)
  O resto do app continua igual.
*/
(function () {
  window.PLATAFORMA_PROPRIA = true;
  var cfgP = null, sbP = null, sessaoP = null;

  function config() {
    if (!cfgP) cfgP = fetch('/api/config').then(function (r) { if (!r.ok) throw new Error('config'); return r.json(); });
    return cfgP;
  }
  function cliente() {
    if (!sbP) sbP = config().then(function (c) {
      return window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    });
    return sbP;
  }
  function sessao() {
    if (!sessaoP) sessaoP = cliente().then(function (sb) {
      return sb.auth.getSession().then(function (r) {
        return (r.data && r.data.session ? Promise.resolve(r.data.session) : telaLogin(sb)).then(function (s) { return confereAcesso(sb, s); });
      });
    });
    return sessaoP;
  }
  function token() {
    return cliente().then(function (sb) { return sb.auth.getSession(); }).then(function (r) { return r.data.session && r.data.session.access_token; });
  }
  function api(caminho, corpo) {
    return token().then(function (t) {
      return fetch(caminho, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify(corpo || {})
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.erro || ('HTTP ' + r.status)); e.code = j.code || ('http_' + r.status); throw e; }
        return j;
      });
    });
  }

  /* Login por link no e-mail */
  function telaLogin(sb) {
    return new Promise(function (resolve) {
      var css = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#ffffff);padding:16px;font-family:inherit';
      var box = document.createElement('div');
      box.setAttribute('style', css);
      box.innerHTML = '<form style="max-width:360px;width:100%;display:grid;gap:12px;background:var(--surface,#fff);padding:20px;border-radius:16px">' +
        '<h1 style="margin:0;font-size:1.6rem">Peleja</h1><p style="margin:-6px 0 4px;color:var(--muted,#555)">Dieta e treino, uma peleja por dia.</p>' +
        '<label for="pl-email">Seu e-mail</label>' +
        '<input id="pl-email" type="email" required autocomplete="email" style="font:inherit;padding:12px;border-radius:10px;border:2px solid var(--line,#c6d4e8)">' +
        '<label for="pl-senha">Senha (se tiver)</label>' +
        '<input id="pl-senha" type="password" autocomplete="current-password" style="font:inherit;padding:12px;border-radius:10px;border:2px solid var(--line,#c6d4e8)">' +
        '<button type="button" id="pl-entrar" style="font:inherit;font-weight:700;padding:12px;border-radius:10px;border:0;background:var(--accent,#1a5fd0);color:#fff">Entrar com senha</button>' +
        '<button type="submit" style="font:inherit;font-weight:700;padding:12px;border-radius:10px;border:2px solid var(--accent,#1a5fd0);background:transparent;color:inherit">Receber link de acesso por e-mail</button>' +
        '<p id="pl-msg" aria-live="polite" style="margin:0"></p>' +
        '<p style="margin:4px 0 0;font-size:.9rem;color:var(--muted,#555)">O acesso é só por convite. Se alguém te indicou o app, peça o link de convite.</p></form>';
      document.body.appendChild(box);
      var form = box.querySelector('form'), msg = box.querySelector('#pl-msg');
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = box.querySelector('#pl-email').value.trim();
        msg.textContent = 'Enviando...';
        sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } }).then(function (r) {
          msg.textContent = r.error ? 'Não consegui enviar: ' + r.error.message : 'Pronto. Abra o link que chegou no seu e-mail neste aparelho.';
        });
      });
      box.querySelector('#pl-entrar').addEventListener('click', function () {
        var email = box.querySelector('#pl-email').value.trim(), senha = box.querySelector('#pl-senha').value;
        if (!email || !senha) { msg.textContent = 'Preencha e-mail e senha.'; return; }
        msg.textContent = 'Entrando...';
        sb.auth.signInWithPassword({ email: email, password: senha }).then(function (r) {
          if (r.error) msg.textContent = 'Não consegui entrar: ' + (r.error.message === 'Invalid login credentials' ? 'e-mail ou senha incorretos.' : r.error.message);
        });
      });
      var cv = new URLSearchParams(location.search).get('convite');
      if (cv) telaConvite(sb, box, cv.toLowerCase());
      sb.auth.onAuthStateChange(function (_ev, s) { if (s) { box.remove(); resolve(s); } });
    });
  }

  /* Pedido de acesso: a conta nasce "pendente" e só entra depois da aprovação */
  var EST_IN = 'font:inherit;padding:12px;border-radius:10px;border:2px solid var(--line,#c6d4e8);background:var(--surface,#fff);color:inherit';
  var EST_BT = 'font:inherit;font-weight:700;padding:12px;border-radius:10px;border:0;background:var(--accent,#1a5fd0);color:var(--on-accent,#fff)';
  function telaConvite(sb, box, codigo) {
    var f = box.querySelector('form');
    var nf = f.cloneNode(false); f.parentNode.replaceChild(nf, f); f = nf;
    f.innerHTML = '<h1 style="margin:0;font-size:1.5rem">Convite</h1><p id="pa-msg" aria-live="polite" style="margin:0">Conferindo o convite...</p>';
    function semConvite() { history.replaceState(null, '', location.pathname + location.hash); }
    function erro(t) {
      f.innerHTML = '<h1 style="margin:0;font-size:1.5rem">Convite</h1><p style="margin:0">' + t + '</p><button type="button" id="pa-volta" style="' + EST_BT + '">Ir para entrar</button>';
      f.querySelector('#pa-volta').addEventListener('click', function () { semConvite(); location.reload(); });
    }
    function post(corpo) {
      return fetch('/api/acesso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
    }
    post({ acao: 'convite', codigo: codigo }).then(function (x) {
      if (!x.ok) { erro(x.j.erro || 'Convite inválido.'); return; }
      f.innerHTML = '<h1 style="margin:0;font-size:1.5rem">Você foi convidado</h1>' +
        '<p style="margin:0">Crie seu acesso ao Peleja, o app de dieta e treino. Depois você entra sempre com este e-mail e esta senha.</p>' +
        '<label for="pa-nome">Seu nome</label><input id="pa-nome" required autocomplete="name" style="' + EST_IN + '">' +
        '<label for="pa-email">Seu e-mail</label><input id="pa-email" type="email" required autocomplete="email" style="' + EST_IN + '">' +
        '<label for="pa-senha">Crie uma senha (mínimo 8 caracteres)</label><input id="pa-senha" type="password" required minlength="8" autocomplete="new-password" style="' + EST_IN + '">' +
        '<label for="pa-senha2">Repita a senha</label><input id="pa-senha2" type="password" required minlength="8" autocomplete="new-password" style="' + EST_IN + '">' +
        '<label style="display:flex;gap:10px;align-items:flex-start;font-weight:400"><input id="pa-termos" type="checkbox" required style="width:22px;height:22px;flex:none;margin-top:2px"><span>Li e aceito os <a href="/termos.html" target="_blank" rel="noopener">termos de uso e privacidade</a>.</span></label>' +
        '<button type="submit" style="' + EST_BT + '">Criar meu acesso</button>' +
        '<p id="pa-msg" aria-live="polite" style="margin:0"></p>';
      f.querySelector('#pa-nome').value = x.j.nome || '';
      if (x.j.email) { var em = f.querySelector('#pa-email'); em.value = x.j.email; em.readOnly = true; }
      var msg = f.querySelector('#pa-msg');
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = f.querySelector('#pa-email').value.trim().toLowerCase(), senha = f.querySelector('#pa-senha').value;
        if (senha !== f.querySelector('#pa-senha2').value) { msg.textContent = 'As senhas não são iguais.'; return; }
        if (!f.querySelector('#pa-termos').checked) { msg.textContent = 'Para criar o acesso, aceite os termos de uso.'; return; }
        msg.textContent = 'Criando...';
        post({ acao: 'aceitar', codigo: codigo, nome: f.querySelector('#pa-nome').value.trim(), email: email, senha: senha, termos: true }).then(function (y) {
          if (!y.ok) { msg.textContent = y.j.erro || 'Não consegui criar o acesso.'; return; }
          msg.textContent = 'Pronto! Entrando...';
          semConvite();
          sb.auth.signInWithPassword({ email: email, password: senha }).then(function (r) {
            if (r.error) msg.textContent = 'Conta criada. Entre com seu e-mail e senha.';
          });
        }, function () { msg.textContent = 'Sem conexão. Tente de novo.'; });
      });
    }, function () { erro('Sem conexão. Abra o link de novo.'); });
  }

  /* Depois do login: só segue com o perfil aprovado */
  function confereAcesso(sb, s) {
    return sb.from('perfis').select('status,admin,nome').eq('user_id', s.user.id).maybeSingle().then(function (r) {
      var p = r.data;
      if (p && p.status === 'aprovado') { window.PERFIL_ACESSO = p; return s; }
      return new Promise(function () {
        var box = document.createElement('div');
        box.setAttribute('style', 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#fff);color:var(--fg,#142338);padding:16px;font-family:inherit');
        var st = p ? p.status : 'pendente';
        box.innerHTML = '<div style="max-width:360px;width:100%;display:grid;gap:12px;background:var(--surface,#fff);padding:20px;border-radius:16px">' +
          '<h1 style="margin:0;font-size:1.5rem">' + (st === 'pendente' ? 'Aguardando aprovação' : 'Acesso não liberado') + '</h1>' +
          '<p style="margin:0">' + (st === 'pendente' ? 'Seu pedido foi recebido. Assim que for aprovado, o app abre normalmente.' : st === 'bloqueado' ? 'Seu acesso está suspenso. Fale com quem te indicou o app.' : 'Seu pedido não foi aprovado. Fale com quem te indicou o app.') + '</p>' +
          (st === 'pendente' ? '<button type="button" id="pg-de-novo" style="' + EST_BT + '">Verificar de novo</button>' : '') +
          '<button type="button" id="pg-sair" style="font:inherit;font-weight:700;border:0;background:none;color:var(--accent,#1a5fd0);padding:8px">Sair</button></div>';
        document.body.appendChild(box);
        var dn = box.querySelector('#pg-de-novo'); if (dn) dn.addEventListener('click', function () { location.reload(); });
        box.querySelector('#pg-sair').addEventListener('click', function () { sb.auth.signOut().then(function () { location.reload(); }); });
      });
    });
  }

  /* Pessoas (só administrador): aprovar, recusar, bloquear, reativar */
  function painelPessoas() {
    var velho = document.getElementById('pl-pes-box'); if (velho) velho.remove();
    var box = document.createElement('div');
    box.id = 'pl-pes-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Pessoas');
    box.setAttribute('style', 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px');
    box.innerHTML = '<div style="background:var(--bg,#fff);color:var(--fg,#142338);max-width:480px;width:100%;box-sizing:border-box;max-height:90vh;overflow:auto;border-radius:20px;padding:18px;display:grid;gap:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 style="margin:0;font-size:1.4rem">Pessoas</h2><button type="button" id="pl-pes-x" aria-label="Fechar" style="font:inherit;font-weight:700;border:0;background:var(--mat,#eee);color:inherit;border-radius:20px;width:40px;height:40px">✕</button></div>' +
      '<div id="pl-pes-c">Carregando...</div></div>';
    document.body.appendChild(box);
    function fecha() { box.remove(); }
    box.addEventListener('click', function (e) { if (e.target === box) fecha(); });
    box.querySelector('#pl-pes-x').addEventListener('click', fecha);
    var c = box.querySelector('#pl-pes-c');
    var NOME = { pendente: 'Aguardando', aprovado: 'Aprovado', recusado: 'Recusado', bloqueado: 'Bloqueado' };
    var ACOES = { pendente: [['aprovado', 'Aprovar'], ['recusado', 'Recusar']], aprovado: [['bloqueado', 'Bloquear']], recusado: [['aprovado', 'Aprovar']], bloqueado: [['aprovado', 'Reativar']] };
    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
    function carrega() {
      api('/api/acesso', { acao: 'lista' }).then(function (j) {
        var ps = j.perfis || [], pend = ps.filter(function (p) { return p.status === 'pendente'; }).length;
        var cs = j.convites || [];
        c.innerHTML = '<form id="cv-form" style="background:var(--surface,#f5f5f5);border-radius:16px;padding:12px 14px;display:grid;gap:8px">' +
          '<strong>Convidar pessoa</strong>' +
          '<label for="cv-nome" style="font-size:.9rem">Nome</label><input id="cv-nome" style="' + EST_IN + '">' +
          '<label for="cv-email" style="font-size:.9rem">E-mail (opcional: se preencher, só esse e-mail usa o convite)</label><input id="cv-email" type="email" style="' + EST_IN + '">' +
          '<button type="submit" style="' + EST_BT + '">Gerar link de convite</button><div id="cv-out"></div></form>' +
          (cs.length ? '<div style="display:grid;gap:6px"><strong>Convites em aberto</strong>' + cs.map(function (v) {
            return '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;background:var(--surface,#f5f5f5);border-radius:14px;padding:8px 12px"><span style="overflow-wrap:anywhere">' + esc(v.nome || v.email || 'Sem nome') + '<br><span style="font-size:.8rem;color:var(--muted,#555)">vence em ' + new Date(v.expira).toLocaleDateString('pt-BR') + '</span></span>' +
              '<span style="display:flex;gap:6px"><button type="button" data-link="' + esc(v.codigo) + '" style="font:inherit;font-weight:700;min-height:36px;padding:0 12px;border-radius:18px;border:0;background:var(--mat,#eee);color:inherit">Link</button><button type="button" data-cancela="' + esc(v.codigo) + '" style="font:inherit;font-weight:600;min-height:36px;padding:0 10px;border-radius:18px;border:0;background:transparent;color:var(--muted,#555)">Cancelar</button></span></div>';
          }).join('') + '</div>' : '') +
          '<p style="margin:0 0 4px;color:var(--muted,#555)">' + (pend ? pend + (pend === 1 ? ' pedido aguardando' : ' pedidos aguardando') + ' aprovação. ' : '') + 'Você vê só nome, e-mail e status; os dados de cada pessoa ficam só com ela.</p>' +
          ps.map(function (p) {
            var bts = p.admin ? '<span style="font-size:.85rem;color:var(--muted,#555)">Administrador</span>' : (ACOES[p.status] || []).map(function (a) {
              return '<button type="button" data-id="' + esc(p.user_id) + '" data-st="' + a[0] + '" style="font:inherit;font-weight:700;min-height:40px;padding:0 14px;border-radius:20px;border:0;' + (a[0] === 'aprovado' ? 'background:var(--accent,#1a5fd0);color:var(--on-accent,#fff)' : 'background:var(--mat,#eee);color:inherit') + '">' + a[1] + '</button>';
            }).join('') + (p.admin ? '' : '<button type="button" data-senha="' + esc(p.user_id) + '" data-nome="' + esc(p.nome || p.email) + '" style="font:inherit;font-weight:600;min-height:40px;padding:0 14px;border-radius:20px;border:0;background:transparent;color:var(--accent,#1a5fd0)">Senha provisória</button>');
            return '<div style="background:var(--surface,#f5f5f5);border-radius:16px;padding:12px 14px;display:grid;gap:8px">' +
              '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><strong>' + esc(p.nome || p.email) + '</strong><span style="font-size:.8rem;font-weight:700;color:' + (p.status === 'pendente' ? 'var(--warn,#a86a12)' : p.status === 'aprovado' ? 'var(--accent,#0e7c4d)' : 'var(--muted,#555)') + '">' + NOME[p.status] + '</span></div>' +
              '<span style="font-size:.85rem;color:var(--muted,#555);overflow-wrap:anywhere">' + esc(p.email) + (p.indicado_por ? ' · indicado por ' + esc(p.indicado_por) : '') + ' · pediu em ' + new Date(p.criado).toLocaleDateString('pt-BR') + '</span>' +
              (p.con ? '<span style="font-size:.85rem;color:var(--muted,#555)">' + [p.con.chave ? 'chave de IA ✓' : (p.admin ? 'chave do servidor' : 'sem chave de IA'), p.con.strava ? 'Strava ✓' : 'sem Strava', p.con.hc ? 'Health Connect ✓' : 'sem Health Connect', p.con.ia30 + ' usos de IA em 30 dias'].join(' · ') + '</span>' : '') +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' + bts + '</div></div>';
          }).join('');
        function mostraLink(codigo, onde) {
          var url = location.origin + '/?convite=' + codigo, txt = 'Te convidei para o Peleja, um app de dieta e treino. Abra este link e crie seu acesso: ' + url;
          onde.innerHTML = '<p style="margin:6px 0;overflow-wrap:anywhere;font-size:.9rem"><code style="user-select:all">' + esc(url) + '</code></p>';
          var row = document.createElement('div'); row.setAttribute('style', 'display:flex;gap:8px;flex-wrap:wrap');
          var BT = 'font:inherit;font-weight:700;min-height:40px;padding:0 14px;border-radius:20px;border:0;';
          if (navigator.share) { var sh = document.createElement('button'); sh.type = 'button'; sh.textContent = 'Compartilhar'; sh.setAttribute('style', BT + 'background:var(--accent,#1a5fd0);color:var(--on-accent,#fff)'); sh.addEventListener('click', function () { navigator.share({ title: 'Peleja', text: txt }).catch(function () {}); }); row.appendChild(sh); }
          var wa = document.createElement('a'); wa.href = 'https://wa.me/?text=' + encodeURIComponent(txt); wa.target = '_blank'; wa.rel = 'noopener'; wa.textContent = 'WhatsApp'; wa.setAttribute('style', BT + 'display:inline-grid;place-items:center;text-decoration:none;background:var(--mat,#eee);color:inherit'); row.appendChild(wa);
          var cp = document.createElement('button'); cp.type = 'button'; cp.textContent = 'Copiar'; cp.setAttribute('style', BT + 'background:var(--mat,#eee);color:inherit');
          cp.addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { cp.textContent = 'Copiado'; }, function () { cp.textContent = 'Selecione e copie'; }); });
          row.appendChild(cp); onde.appendChild(row);
          var nota = document.createElement('p'); nota.textContent = 'O link vale por 14 dias e serve para uma conta só.'; nota.setAttribute('style', 'margin:6px 0 0;font-size:.85rem;color:var(--muted,#555)'); onde.appendChild(nota);
        }
        c.querySelector('#cv-form').addEventListener('submit', function (ev) {
          ev.preventDefault();
          var out = c.querySelector('#cv-out'); out.textContent = 'Gerando...';
          api('/api/acesso', { acao: 'convidar', nome: c.querySelector('#cv-nome').value.trim(), email: c.querySelector('#cv-email').value.trim() }).then(function (k) {
            mostraLink(k.codigo, out);
          }, function (e) { out.textContent = e.message; });
        });
        c.querySelectorAll('[data-link]').forEach(function (b) { b.addEventListener('click', function () { var d = document.createElement('div'); b.closest('div').after(d); mostraLink(b.getAttribute('data-link'), d); b.disabled = true; }); });
        c.querySelectorAll('[data-cancela]').forEach(function (b) { b.addEventListener('click', function () { if (!confirm('Cancelar este convite? O link deixa de funcionar.')) return; api('/api/acesso', { acao: 'cancelar', codigo: b.getAttribute('data-cancela') }).then(carrega); }); });
        c.querySelectorAll('[data-st]').forEach(function (b) {
          b.addEventListener('click', function () {
            b.disabled = true;
            api('/api/acesso', { acao: 'status', user_id: b.getAttribute('data-id'), status: b.getAttribute('data-st') }).then(carrega, function (e) { b.disabled = false; alert(e.message); });
          });
        });
        c.querySelectorAll('[data-senha]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('Criar uma senha provisória para ' + b.getAttribute('data-nome') + '? A senha atual dela deixa de funcionar.')) return;
            b.disabled = true;
            api('/api/acesso', { acao: 'senha', user_id: b.getAttribute('data-senha') }).then(function (j) {
              var cx = b.parentNode, p = document.createElement('p');
              p.setAttribute('style', 'margin:0;width:100%;display:flex;gap:8px;align-items:center;flex-wrap:wrap');
              p.innerHTML = 'Senha provisória: <code style="font-size:1.1rem;font-weight:700;user-select:all;background:var(--mat,#eee);padding:4px 8px;border-radius:8px">' + esc(j.senha) + '</code>';
              var cp = document.createElement('button'); cp.type = 'button'; cp.textContent = 'Copiar';
              cp.setAttribute('style', 'font:inherit;font-weight:700;min-height:36px;padding:0 12px;border-radius:18px;border:0;background:var(--mat,#eee);color:inherit');
              cp.addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(j.senha) : Promise.reject()).then(function () { cp.textContent = 'Copiado'; }, function () { cp.textContent = 'Selecione e copie'; }); });
              p.appendChild(cp);
              var dica = document.createElement('span'); dica.textContent = 'Mande para a pessoa e peça para trocar em Conta → Trocar senha.'; dica.setAttribute('style', 'font-size:.85rem;color:var(--muted,#555)');
              p.appendChild(dica);
              cx.parentNode.appendChild(p); b.remove();
            }, function (e) { b.disabled = false; alert(e.message); });
          });
        });
      }, function (e) { c.textContent = 'Não consegui carregar: ' + e.message; });
    }
    carrega();
  }

  /* Trocar a própria senha */
  function painelSenha(sb) {
    var velho = document.getElementById('pl-senha-box'); if (velho) velho.remove();
    var box = document.createElement('div');
    box.id = 'pl-senha-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Trocar senha');
    box.setAttribute('style', 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px');
    box.innerHTML = '<form style="background:var(--bg,#fff);color:var(--fg,#142338);max-width:380px;width:100%;box-sizing:border-box;border-radius:20px;padding:18px;display:grid;gap:10px">' +
      '<h2 style="margin:0;font-size:1.4rem">Trocar senha</h2>' +
      '<label for="ts-1">Nova senha (mínimo 8 caracteres)</label><input id="ts-1" type="password" required minlength="8" autocomplete="new-password" style="' + EST_IN + '">' +
      '<label for="ts-2">Repita a nova senha</label><input id="ts-2" type="password" required minlength="8" autocomplete="new-password" style="' + EST_IN + '">' +
      '<button type="submit" style="' + EST_BT + '">Salvar senha</button>' +
      '<button type="button" id="ts-x" style="font:inherit;font-weight:700;border:0;background:none;color:var(--accent,#1a5fd0);padding:8px">Cancelar</button>' +
      '<p id="ts-msg" aria-live="polite" style="margin:0"></p></form>';
    document.body.appendChild(box);
    var f = box.querySelector('form'), msg = box.querySelector('#ts-msg');
    function fecha() { box.remove(); }
    box.addEventListener('click', function (e) { if (e.target === box) fecha(); });
    box.querySelector('#ts-x').addEventListener('click', fecha);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var a = box.querySelector('#ts-1').value, b2 = box.querySelector('#ts-2').value;
      if (a !== b2) { msg.textContent = 'As senhas não são iguais.'; return; }
      msg.textContent = 'Salvando...';
      sb.auth.updateUser({ password: a }).then(function (r) {
        if (r.error) { msg.textContent = 'Não consegui trocar: ' + r.error.message; return; }
        msg.textContent = 'Senha trocada.'; setTimeout(fecha, 1200);
      });
    });
  }

  /* db: mesma interface que o app usava (collection().doc().set/delete e onSnapshot) */
  function criaDb(sb, uid) {
    var ouvintes = {}, dados = {}, canal = null;
    function snap(c) {
      var m = dados[c] || {};
      return { docs: Object.keys(m).map(function (id) { return { id: id, data: function () { return m[id]; } }; }) };
    }
    function avisa(c) { (ouvintes[c] || []).forEach(function (o) { o.ok(snap(c)); }); }
    function abreCanal() {
      if (canal) return;
      canal = sb.channel('docs-' + uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'user_id=eq.' + uid }, function (p) {
          var row = p.new && p.new.colecao ? p.new : p.old;
          if (!row || !row.colecao) return;
          dados[row.colecao] = dados[row.colecao] || {};
          if (p.eventType === 'DELETE') delete dados[row.colecao][row.id];
          else dados[row.colecao][row.id] = p.new.data;
          avisa(row.colecao);
        })
        .subscribe();
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') Object.keys(ouvintes).forEach(carrega);
      });
    }
    function carrega(c) {
      var todos = {}, de = 0, passo = 1000;
      function pagina() {
        return sb.from('docs').select('id,data').eq('user_id', uid).eq('colecao', c).range(de, de + passo - 1).then(function (r) {
          if (r.error) throw r.error;
          r.data.forEach(function (row) { todos[row.id] = row.data; });
          if (r.data.length === passo) { de += passo; return pagina(); }
        });
      }
      return pagina().then(function () { dados[c] = todos; avisa(c); })
        .catch(function (e) { (ouvintes[c] || []).forEach(function (o) { if (o.err) o.err(e); }); });
    }
    return {
      collection: function (c) {
        return {
          onSnapshot: function (ok, err) {
            (ouvintes[c] = ouvintes[c] || []).push({ ok: ok, err: err });
            abreCanal(); carrega(c);
            return function () {};
          },
          doc: function (id) {
            return {
              set: function (data) {
                dados[c] = dados[c] || {}; dados[c][id] = data;
                return sb.from('docs').upsert({ user_id: uid, colecao: c, id: id, data: data, atualizado: new Date().toISOString() }).then(function (r) { if (r.error) throw r.error; });
              },
              delete: function () {
                if (dados[c]) delete dados[c][id];
                return sb.from('docs').delete().eq('user_id', uid).eq('colecao', c).eq('id', id).then(function (r) { if (r.error) throw r.error; });
              }
            };
          }
        };
      }
    };
  }

  /* assets: upload(blob) -> { id, url } e delete(id) */
  function criaAssets(sb, uid) {
    return {
      upload: function (blob) {
        var tipo = blob.type || 'image/jpeg', ext = (tipo.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('+xml', '');
        var caminho = uid + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.' + ext;
        return sb.storage.from('fotos').upload(caminho, blob, { contentType: tipo, upsert: false }).then(function (r) {
          if (r.error) throw r.error;
          return { id: caminho, url: sb.storage.from('fotos').getPublicUrl(caminho).data.publicUrl };
        });
      },
      delete: function (id) {
        return sb.storage.from('fotos').remove([id]).then(function (r) { if (r.error) throw r.error; });
      }
    };
  }

  /* sample: json(prompt, { images }) -> objeto */
  function blobParaBase64(b) {
    return new Promise(function (ok, erro) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); ok({ tipo: b.type || 'image/jpeg', base64: s.slice(s.indexOf(',') + 1) }); };
      fr.onerror = erro;
      fr.readAsDataURL(b);
    });
  }
  function criaSample() {
    function json(prompt, opts) {
      var imgs = (opts && opts.images) || [];
      return Promise.all(imgs.map(blobParaBase64)).then(function (imagens) {
        return api('/api/ia', { prompt: prompt, imagens: imagens });
      }).then(function (r) { return r.resultado; });
    }
    var f = function (prompt, opts) { return json(prompt, opts); };
    f.json = json;
    f.local = function (tipo) { return api('/api/ia', { local: tipo }); };
    return f;
  }

  /* mcp: callTool('Strava', ferramenta, args) -> { payload } */
  function criaMcp() {
    return {
      callTool: function (servidor, ferramenta, args) {
        if (servidor !== 'Strava') return Promise.reject({ code: 'sem_mcp' });
        return api('/api/strava', { ferramenta: ferramenta, args: args || {} }).then(function (j) { return { payload: j.payload }; })
          .catch(function (e) { if (e.code === 'strava_desconectado') mostraConectarStrava(); throw e; });
      }
    };
  }

  /* Menu da conta: conectar Strava e sair */
  function mostraConectarStrava() {
    if (document.getElementById('pl-strava')) return;
    var b = document.createElement('button');
    b.id = 'pl-strava'; b.type = 'button'; b.textContent = 'Conectar Strava';
    b.setAttribute('style', 'position:fixed;right:12px;bottom:12px;z-index:9000;font:inherit;font-weight:700;padding:10px 14px;border-radius:999px;border:0;background:#fc4c02;color:#fff');
    b.addEventListener('click', function () {
      if (window.abreStrava) { window.abreStrava(); return; }
      api('/api/strava-conectar', {}).then(function (j) { location.href = j.url; }, function (e) { alert('Não consegui iniciar a conexão: ' + e.message); });
    });
    document.body.appendChild(b);
  }
  function menuConta(sb) {
    var d = document.createElement('details');
    d.className = 'conta-menu';
    d.innerHTML = '<summary aria-label="Conta"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><span>Conta</span></summary>' +
      '<div class="conta-pop"><button type="button" id="pl-uso">Uso da IA</button><button type="button" id="pl-con">Conectar Strava</button><button type="button" id="pl-hc">Health Connect (Android)</button><div class="pl-tema" role="group" aria-label="Tema"><span>Tema</span><button type="button" data-tema="auto">Auto</button><button type="button" data-tema="claro">Claro</button><button type="button" data-tema="escuro">Escuro</button></div><button type="button" id="pl-cfg">Configurações</button><button type="button" id="pl-tour">Tour do app</button><button type="button" id="pl-termos">Termos e privacidade</button><button type="button" id="pl-senha">Trocar senha</button><button type="button" id="pl-pessoas" hidden>Pessoas</button><button type="button" id="pl-sugestoes" hidden>Exercícios sugeridos</button><button type="button" id="pl-fabrica" hidden>Fábrica de GIFs</button><button type="button" id="pl-sair">Sair</button></div>';
    var rec = document.getElementById('t-receitas');
    if (rec && rec.parentNode) {
      var col = document.createElement('div');
      col.className = 'topo-acoes';
      rec.parentNode.insertBefore(col, rec);
      col.appendChild(rec); col.appendChild(d);
    } else {
      d.setAttribute('style', 'position:fixed;right:12px;top:12px;z-index:9000');
      document.body.appendChild(d);
    }
    document.addEventListener('click', function (e) { if (d.open && !d.contains(e.target)) d.open = false; });
    d.querySelector('#pl-con').addEventListener('click', function () { d.open = false; if (window.abreStrava) window.abreStrava(); else api('/api/strava-conectar', {}).then(function (j) { location.href = j.url; }); });
    d.querySelector('#pl-uso').addEventListener('click', function () { d.open = false; painelUso(sb); });
    d.querySelector('#pl-hc').addEventListener('click', function () { d.open = false; painelHC(); });
    function marcaTema() { var t = window.dtTema ? window.dtTema.atual() : 'auto'; d.querySelectorAll('[data-tema]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tema') === t)); }); }
    d.querySelectorAll('[data-tema]').forEach(function (b) { b.addEventListener('click', function () { if (window.dtTema) window.dtTema.muda(b.getAttribute('data-tema')); marcaTema(); }); });
    marcaTema();
    d.querySelector('#pl-cfg').addEventListener('click', function () { d.open = false; if (window.abreConfig) window.abreConfig(); });
    d.querySelector('#pl-tour').addEventListener('click', function () { d.open = false; if (window.abreTour) window.abreTour(); });
    d.querySelector('#pl-termos').addEventListener('click', function () { d.open = false; window.open('/termos.html', '_blank', 'noopener'); });
    d.querySelector('#pl-senha').addEventListener('click', function () { d.open = false; painelSenha(sb); });
    var bp = d.querySelector('#pl-pessoas');
    if (window.PERFIL_ACESSO && window.PERFIL_ACESSO.admin) { bp.hidden = false; bp.addEventListener('click', function () { d.open = false; painelPessoas(); }); }
    var bf = d.querySelector('#pl-fabrica');
    if (window.PERFIL_ACESSO && window.PERFIL_ACESSO.admin) { bf.hidden = false; bf.addEventListener('click', function () { d.open = false; if (window.abreFabrica) window.abreFabrica(); }); }
    var bs = d.querySelector('#pl-sugestoes');
    if (window.PERFIL_ACESSO && window.PERFIL_ACESSO.admin) { bs.hidden = false; bs.addEventListener('click', function () { d.open = false; if (window.abreSugestoes) window.abreSugestoes(); }); }
    d.querySelector('#pl-sair').addEventListener('click', function () { sb.auth.signOut().then(function () { location.reload(); }); });
  }

  /* Health Connect: endereço e chave para o app "Health Connect Webhook" */
  function painelHC() {
    var velho = document.getElementById('pl-hc-box'); if (velho) velho.remove();
    var box = document.createElement('div');
    box.id = 'pl-hc-box';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Health Connect');
    box.setAttribute('style', 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.35);display:grid;place-items:center;padding:16px');
    box.innerHTML = '<div style="background:var(--bg,#fff);color:var(--fg,#142338);max-width:460px;width:100%;max-height:90vh;overflow:auto;border-radius:16px;padding:18px;display:grid;gap:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 style="margin:0;font-size:1.4rem">Health Connect</h2><button type="button" id="pl-hc-x" style="font:inherit;font-weight:700;border:0;background:none;color:inherit;font-size:1.4rem" aria-label="Fechar">×</button></div>' +
      '<div id="pl-hc-c">Carregando...</div></div>';
    document.body.appendChild(box);
    function fecha() { box.remove(); }
    box.addEventListener('click', function (e) { if (e.target === box) fecha(); });
    box.querySelector('#pl-hc-x').addEventListener('click', fecha);
    var c = box.querySelector('#pl-hc-c');
    var est = 'font:inherit;font-weight:700;min-height:44px;padding:8px 14px;border-radius:10px;border:2px solid var(--accent,#1a5fd0);background:transparent;color:inherit';
    function campo(rot, valor, id) {
      return '<div style="display:grid;gap:6px"><strong>' + rot + '</strong><code id="' + id + '" style="word-break:break-all;background:var(--panel,#f2f5fa);padding:8px;border-radius:8px;user-select:all">' + valor + '</code>' +
        '<button type="button" data-copia="' + id + '" style="' + est + ';justify-self:start">Copiar</button></div>';
    }
    function mostra(j) {
      var APK = 'https://github.com/sandersoncaetano/dieta-e-treino/releases/latest/download/peleja-sync.apk';
      var link = 'dietaetreino://config?url=' + encodeURIComponent(j.url) + '&chave=' + encodeURIComponent(j.chave);
      var quando = j.ultimoEnvio ? new Date(j.ultimoEnvio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nenhum ainda';
      c.innerHTML = '<div style="display:grid;gap:14px">' +
        '<p style="margin:0"><strong>O que é:</strong> o Health Connect é um app do Google para Android que reúne num lugar só os dados de saúde dos seus outros apps, como o do seu smartwatch, da sua balança ou o Google Fit. Com ele, peso, composição corporal, sono, frequência cardíaca, passos e atividades do relógio chegam ao Peleja sozinhos, sem você digitar.</p>' +
        '<p style="margin:0;font-size:.9rem;color:var(--muted,#555)">Só funciona em Android. No iPhone ainda não há essa ligação; quem treina com Apple Watch pode conectar o Strava.</p>' +
        '<ol style="margin:0;padding-left:1.2em;display:grid;gap:10px">' +
        '<li><strong>Tenha o Health Connect no celular.</strong> No Android 14 ou mais novo ele já vem no sistema (Configurações › Segurança e privacidade › Privacidade › Health Connect, ou pesquise "Health Connect" nas Configurações). No Android 13 ou mais antigo, <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata" target="_blank" rel="noopener">instale pela Play Store</a>.</li>' +
        '<li><strong>Se você tem smartwatch ou balança inteligente, ligue o app dele ao Health Connect.</strong> Abra o app que acompanha o aparelho, procure "Health Connect" nas configurações e permita que ele grave os dados. Sem relógio, o próprio celular já conta os passos (pelo Google Fit, por exemplo).</li>' +
        '<li><strong>Instale o Peleja Sync</strong>, o app que leva os dados do Health Connect para cá a cada hora: <a href="' + APK + '">baixe aqui</a> e instale. O Android vai pedir para permitir a instalação pelo navegador; é só aceitar.</li>' +
        '<li>Volte aqui e toque em <strong>Configurar app Android</strong>: o Peleja Sync abre já com o seu endereço e a sua chave.</li>' +
        '<li>No Peleja Sync, toque em <strong>Permitir leitura no Health Connect</strong> e libere tudo, inclusive a leitura em segundo plano. Depois toque em <strong>Sincronizar agora</strong>.</li></ol>' +
        '<p style="margin:0;font-size:.9rem;color:var(--muted,#555)">Corridas, caminhadas e pedaladas do relógio entram no Cardio para quem não conectou o Strava. Se você já usava o app, atualize-o e toque de novo em Permitir leitura, para liberar as atividades.</p>' +
        '<a id="pl-hc-cfg" href="' + link + '" style="' + est + ';justify-self:start;text-decoration:none;display:inline-grid;place-items:center;background:var(--accent,#1a5fd0);color:#fff">Configurar app Android</a>' +
        '<details><summary>Configurar à mão ou usar outro app</summary><div style="display:grid;gap:12px;margin-top:10px">' +
        '<p style="margin:0">Serve também para o app Health Connect Webhook: endereço abaixo, formato JSON, cabeçalho <code>x-api-key</code> com a chave.</p>' +
        campo('Endereço', j.url, 'pl-hc-url') + campo('Chave (cabeçalho x-api-key)', j.chave, 'pl-hc-key') +
        '</div></details>' +
        '<p style="margin:0">Último envio recebido: <strong>' + quando + '</strong></p>' +
        '<p style="margin:0;font-size:.9em">A chave dá acesso só para enviar dados ao app. Se ela vazar, gere outra (a antiga para de funcionar).</p>' +
        '<button type="button" id="pl-hc-novo" style="' + est + ';justify-self:start">Gerar nova chave</button></div>';
      c.querySelectorAll('[data-copia]').forEach(function (b) {
        b.addEventListener('click', function () {
          var t = document.getElementById(b.getAttribute('data-copia')).textContent;
          (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { b.textContent = 'Copiado'; }, function () { b.textContent = 'Selecione e copie'; });
        });
      });
      c.querySelector('#pl-hc-novo').addEventListener('click', function () {
        c.querySelector('#pl-hc-novo').disabled = true;
        api('/api/saude', { novo: true }).then(mostra, function (e) { c.textContent = 'Erro: ' + e.message; });
      });
    }
    api('/api/saude', {}).then(mostra, function (e) { c.textContent = 'Não consegui abrir: ' + e.message; });
  }

  /* Painel de uso da IA */
  function painelUso(sb) {
    var velho = document.getElementById('pl-uso-box'); if (velho) velho.remove();
    var box = document.createElement('div');
    box.id = 'pl-uso-box';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Uso da IA');
    box.setAttribute('style', 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.35);display:grid;place-items:center;grid-template-columns:minmax(0,1fr);padding:16px');
    box.innerHTML = '<div style="background:var(--bg,#fff);color:var(--fg,#142338);max-width:440px;width:100%;min-width:0;box-sizing:border-box;max-height:90vh;overflow:auto;overflow-wrap:anywhere;border-radius:16px;padding:18px;display:grid;gap:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 style="margin:0;font-size:1.4rem">Uso da IA</h2><button type="button" id="pl-uso-x" style="font:inherit;font-weight:700;border:0;background:none;color:inherit;font-size:1.4rem" aria-label="Fechar">×</button></div>' +
      '<div id="pl-uso-c">Carregando...</div></div>';
    document.body.appendChild(box);
    function fecha() { box.remove(); }
    box.addEventListener('click', function (e) { if (e.target === box) fecha(); });
    box.querySelector('#pl-uso-x').addEventListener('click', fecha);
    var desde = new Date(); desde.setDate(1); desde.setHours(0, 0, 0, 0);
    var mesAnt = new Date(desde); mesAnt.setMonth(mesAnt.getMonth() - 1);
    var cotP = fetch('/api/cotacao').then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; });
    Promise.all([config(), sb.from('uso_ia').select('criado,tipo,modelo,entrada,saida,imagens').order('criado', { ascending: true }).limit(20000), cotP]).then(function (r) {
      var cfg = r[0], q = r[1], cot = r[2], c = box.querySelector('#pl-uso-c');
      var moeda = 'USD';
      try { moeda = localStorage.getItem('dt-moeda') === 'BRL' ? 'BRL' : 'USD'; } catch (e) {}
      cfg = { precoEntrada: Number(cfg.precoEntrada) || 3, precoSaida: Number(cfg.precoSaida) || 15, cotacaoDolar: Number(cfg.cotacaoDolar) || null };
      if (q.error) { c.textContent = 'Não consegui ler o uso: ' + q.error.message; return; }
      var todas = q.data || [];
      var locais = todas.filter(function (x) { return x.modelo === 'local'; });
      var rows = todas.filter(function (x) { return x.modelo !== 'local'; });
      if (!rows.length) { c.textContent = 'Nenhuma chamada à IA registrada ainda.'; return; }
      // Haiku custa cerca de 1/3 do Sonnet (US$ 1 e US$ 5 por milhão de tokens).
      function custo(x) { var hk = /haiku/i.test(x.modelo || ''); return (x.entrada * (hk ? 1 : cfg.precoEntrada) + x.saida * (hk ? 5 : cfg.precoSaida)) / 1e6; }
      function soma(lista) { var t = { n: 0, tok: 0, img: 0, usd: 0 }; lista.forEach(function (x) { t.n++; t.tok += x.entrada + x.saida; t.img += x.imagens; t.usd += custo(x); }); return t; }
      function dinheiro(v) {
        if (moeda === 'BRL' && cot && cot.valor) { var b = v * cot.valor; return 'R$ ' + b.toFixed(2).replace('.', ','); }
        return 'US$ ' + v.toFixed(v < 1 ? 3 : 2).replace('.', ',');
      }
      function mil(n) { return n >= 1000 ? Math.round(n / 1000).toLocaleString('pt-BR') + ' mil' : String(n); }
      function ch(n) { return n + (n === 1 ? ' chamada' : ' chamadas'); }
      function dia0(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
      var hoje = dia0(new Date()), sete = new Date(hoje); sete.setDate(sete.getDate() - 6);
      var inicio = dia0(rows[0].criado);
      var diasUso = Math.round((hoje - inicio) / 864e5) + 1;
      var lin = 'display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 12px;padding:9px 0;border-bottom:1px solid var(--line,#c6d4e8)';
      var sub = 'font-size:.88rem;color:var(--muted,#4f5f78)';
      function monta() {
      var bt = function (m, rot) { return '<button type="button" data-moeda="' + m + '" aria-pressed="' + (moeda === m) + '" style="flex:1;min-height:44px;border:0;border-radius:9px;font:inherit;font-weight:700;' + (moeda === m ? 'background:var(--bg,#fff);color:var(--accent,#1a5fd0);box-shadow:0 1px 3px rgba(20,35,56,.15)' : 'background:transparent;color:var(--muted,#4f5f78)') + '">' + rot + '</button>'; };
      var h = '<div style="min-width:0">' +
        '<div role="group" aria-label="Moeda" style="display:flex;gap:4px;padding:4px;margin-bottom:6px;background:var(--mat,#e4ecf8);border-radius:12px">' + bt('USD', 'Dólar (US$)') + bt('BRL', 'Real (R$)') + '</div>';
      if (moeda === 'BRL') {
        h += cot && cot.valor
          ? '<p style="margin:0 0 4px;' + sub + '">Dólar a R$ ' + cot.valor.toFixed(2).replace('.', ',') + (cot.quando ? ', cotação de ' + new Date(cot.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + ' (' + cot.fonte + ').</p>'
          : '<p style="margin:0 0 4px;' + sub + '">Não consegui buscar a cotação agora; mostrando em dólar.</p>';
      }
      var per = [['Hoje', rows.filter(function (x) { return new Date(x.criado) >= hoje; })]];
      if (diasUso > 1) per.push([diasUso >= 7 ? 'Últimos 7 dias' : 'Desde o início (' + inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ')', rows.filter(function (x) { return new Date(x.criado) >= (diasUso >= 7 ? sete : inicio); })]);
      if (diasUso > 7) per.push(['Este mês', rows.filter(function (x) { return new Date(x.criado) >= desde; })]);
      var ant = rows.filter(function (x) { var d = new Date(x.criado); return d >= mesAnt && d < desde; });
      if (ant.length) per.push(['Mês passado', ant]);
      per.forEach(function (p) { var t = soma(p[1]); h += '<div style="' + lin + '"><strong>' + p[0] + '</strong><span>' + ch(t.n) + ' · ' + dinheiro(t.usd) + '</span></div>'; });
      var tot = soma(rows), med = tot.usd / diasUso;
      h += '<p style="margin:12px 0 0">Em ' + diasUso + (diasUso === 1 ? ' dia' : ' dias') + ' de uso, a média é de <strong>' + dinheiro(med) + ' por dia</strong>, o que daria cerca de <strong>' + dinheiro(med * 30) + ' por mês</strong>.</p>';
      if (diasUso < 7) h += '<p style="margin:6px 0 0;' + sub + '">Com poucos dias de uso, a média ainda oscila: os primeiros dias tiveram testes e análises de histórico que não se repetem todo dia.</p>';
      if (locais.length) {
        // Economia: cada caso resolvido no app vale o custo médio que aquele tipo tinha com IA.
        var medTipo = {}, porTipo = {};
        rows.forEach(function (x) { var m = medTipo[x.tipo] || (medTipo[x.tipo] = { n: 0, usd: 0 }); m.n++; m.usd += custo(x); });
        var eco = 0, eco7 = 0, n7 = 0;
        locais.forEach(function (x) {
          var m = medTipo[x.tipo], v = m ? m.usd / m.n : 0; eco += v;
          if (new Date(x.criado) >= sete) { eco7 += v; n7++; }
          porTipo[x.tipo] = (porTipo[x.tipo] || 0) + 1;
        });
        var nm = { refeicao: 'refeições', dia: 'fechar o dia', atividade: 'atividades', treinador: 'treinador', semana: 'pesagem', fechamento: 'fechamento da semana' };
        h += '<div style="margin-top:14px;padding:12px;border-radius:12px;background:color-mix(in srgb,var(--ok,#1f8a4c) 12%,transparent)">' +
          '<strong>Resolvidas no app, sem IA: ' + locais.length + '</strong>' +
          '<div style="' + sub + ';margin-top:2px">' + Object.keys(porTipo).map(function (k) { return porTipo[k] + ' de ' + (nm[k] || k); }).join(', ') + '</div>' +
          '<p style="margin:6px 0 0">Economia estimada: <strong>' + dinheiro(eco) + '</strong>' + (n7 && n7 !== locais.length ? ' (' + dinheiro(eco7) + ' nos últimos 7 dias)' : '') + '.</p>' +
          '<p style="margin:4px 0 0;' + sub + '">Calculada pelo custo médio que cada tipo tinha quando ia para a IA.</p></div>';
      }
      var nomes = { refeicao: 'Refeições', dia: 'Fechar o dia', receita: 'Receitas', atividade: 'Análise de atividades', semana: 'Análise da pesagem', fechamento: 'Fechamento da semana', treinador: 'Treinador de corrida', ficha: 'Ficha da academia', triagem: 'Triagem de sugestões', outro: 'Outros' };
      var tipos = {};
      rows.forEach(function (x) { (tipos[x.tipo] = tipos[x.tipo] || []).push(x); });
      h += '<h3 style="margin:16px 0 2px;font-size:1.1rem">Por tipo, desde o início</h3>';
      Object.keys(tipos).sort(function (a, b) { return soma(tipos[b]).usd - soma(tipos[a]).usd; }).forEach(function (k) {
        var t = soma(tipos[k]);
        h += '<div style="' + lin + ';display:block"><div style="display:flex;justify-content:space-between;gap:12px"><strong>' + (nomes[k] || k) + '</strong><span style="white-space:nowrap">' + dinheiro(t.usd) + '</span></div>' +
          '<div style="' + sub + '">' + ch(t.n) + (t.img ? ', ' + t.img + (t.img === 1 ? ' foto' : ' fotos') : '') + ' · ' + mil(t.tok) + ' tokens</div></div>';
      });
      h += '<p style="margin:12px 0 0;' + sub + '">Estimativa com US$ ' + cfg.precoEntrada + ' por milhão de tokens de entrada e US$ ' + cfg.precoSaida + ' de saída no Sonnet (US$ 1 e US$ 5 no Haiku). O valor cobrado de fato está em console.anthropic.com, em Usage e Billing, em dólar' + (moeda === 'BRL' ? '; a fatura do cartão em reais pode vir um pouco diferente por causa de IOF e da cotação do banco' : '') + '.</p></div>';
      c.innerHTML = h;
      c.querySelectorAll('[data-moeda]').forEach(function (b) {
        b.addEventListener('click', function () {
          moeda = b.getAttribute('data-moeda');
          try { localStorage.setItem('dt-moeda', moeda); } catch (e) {}
          monta();
        });
      });
      }
      monta();
    });
  }

  /* Aviso de descanso por notificação (funciona com o app em segundo plano) */
  function b64(u) { var p = '='.repeat((4 - u.length % 4) % 4), s = atob((u + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  var alertaAtual = null, inscritoP = null;
  function inscrever() {
    if (inscritoP) return inscritoP;
    inscritoP = Promise.all([cliente(), config(), navigator.serviceWorker.ready]).then(function (r) {
      var sb = r[0], cfg = r[1], reg = r[2];
      if (!cfg.vapidPublic || !reg.pushManager) throw new Error('sem push');
      return reg.pushManager.getSubscription().then(function (sub) {
        return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.vapidPublic) });
      }).then(function (sub) {
        var j = sub.toJSON();
        return sb.from('push_inscricoes').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }).then(function (x) { if (x.error) throw x.error; return true; });
      });
    });
    inscritoP.catch(function () { inscritoP = null; });
    return inscritoP;
  }
  window.AlertaPush = {
    disponivel: function () { return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window; },
    permissao: function () { return 'Notification' in window ? Notification.permission : 'denied'; },
    ativar: function () {
      if (!window.AlertaPush.disponivel()) return Promise.resolve('indisponivel');
      return Notification.requestPermission().then(function (p) { return p === 'granted' ? inscrever().then(function () { return 'ok'; }) : p; });
    },
    agendar: function (quando, titulo, corpo) {
      if (!window.AlertaPush.disponivel()) return;
      var pedir = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
      var meu = {};
      window.AlertaPush.cancelar();
      alertaAtual = meu;
      pedir.then(function (p) {
        if (p !== 'granted' || alertaAtual !== meu) return;
        return inscrever().then(function () { return cliente(); }).then(function (sb) {
          return sb.from('alertas').insert({ dispara_em: new Date(quando).toISOString(), titulo: titulo, corpo: corpo || null }).select('id').single();
        }).then(function (r) {
          if (r && r.data) meu.id = r.data.id;
          if (alertaAtual !== meu && meu.id) cancelaId(meu.id);
        });
      }).catch(function () {});
    },
    cancelar: function () {
      var a = alertaAtual; alertaAtual = null;
      if (a && a.id) cancelaId(a.id);
    }
  };
  function cancelaId(id) { cliente().then(function (sb) { return sb.from('alertas').delete().eq('id', id); }).catch(function () {}); }

  var servicos = null;
  function prontos() {
    if (!servicos) servicos = Promise.all([cliente(), sessao()]).then(function (r) {
      var sb = r[0], uid = r[1].user.id;
      if (document.body) menuConta(sb); else window.addEventListener('DOMContentLoaded', function () { menuConta(sb); });
      return { db: criaDb(sb, uid), assets: criaAssets(sb, uid), sample: criaSample(), mcp: criaMcp() };
    });
    return servicos;
  }

  // IA só para quem tem chave própria (ou o administrador, que usa a do servidor).
  var iaP = null;
  function iaPronta() {
    if (!iaP) iaP = api('/api/chave', { acao: 'status' }).then(function (st) { window.CHAVE_IA = st; return st.tem || st.usaServidor ? criaSample() : null; }).catch(function () { return criaSample(); });
    return iaP;
  }
  window.Plataforma = { api: api, recarregaIA: function () { iaP = null; }, sair: function () { return cliente().then(function (sb) { return sb.auth.signOut(); }); } };
  window.claude = {
    use: function (nome) {
      if (nome === 'sample') return prontos().then(iaPronta);
      return prontos().then(function (s) { return s[nome] || null; });
    }
  };

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
})();
