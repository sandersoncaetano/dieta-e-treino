/*
  Plataforma própria do Dieta e Treino.
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
        if (r.data && r.data.session) return r.data.session;
        return telaLogin(sb);
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
        '<h1 style="margin:0;font-size:1.6rem">Dieta e Treino</h1>' +
        '<label for="pl-email">Seu e-mail</label>' +
        '<input id="pl-email" type="email" required autocomplete="email" style="font:inherit;padding:12px;border-radius:10px;border:2px solid var(--line,#c6d4e8)">' +
        '<label for="pl-senha">Senha (se tiver)</label>' +
        '<input id="pl-senha" type="password" autocomplete="current-password" style="font:inherit;padding:12px;border-radius:10px;border:2px solid var(--line,#c6d4e8)">' +
        '<button type="button" id="pl-entrar" style="font:inherit;font-weight:700;padding:12px;border-radius:10px;border:0;background:var(--accent,#1a5fd0);color:#fff">Entrar com senha</button>' +
        '<button type="submit" style="font:inherit;font-weight:700;padding:12px;border-radius:10px;border:2px solid var(--accent,#1a5fd0);background:transparent;color:inherit">Receber link de acesso por e-mail</button>' +
        '<p id="pl-msg" aria-live="polite" style="margin:0"></p></form>';
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
      sb.auth.onAuthStateChange(function (_ev, s) { if (s) { box.remove(); resolve(s); } });
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
      api('/api/strava-conectar', {}).then(function (j) { location.href = j.url; }, function (e) { alert('Não consegui iniciar a conexão: ' + e.message); });
    });
    document.body.appendChild(b);
  }
  function menuConta(sb) {
    var d = document.createElement('details');
    d.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:9000;font-size:.85rem');
    d.innerHTML = '<summary style="cursor:pointer;opacity:.6">Conta</summary><div style="display:grid;gap:6px;margin-top:6px;background:var(--surface,#fff);padding:10px;border-radius:10px">' +
      '<button type="button" id="pl-con">Conectar ou reconectar Strava</button><button type="button" id="pl-sair">Sair</button></div>';
    document.body.appendChild(d);
    d.querySelector('#pl-con').addEventListener('click', function () { api('/api/strava-conectar', {}).then(function (j) { location.href = j.url; }); });
    d.querySelector('#pl-sair').addEventListener('click', function () { sb.auth.signOut().then(function () { location.reload(); }); });
  }

  var servicos = null;
  function prontos() {
    if (!servicos) servicos = Promise.all([cliente(), sessao()]).then(function (r) {
      var sb = r[0], uid = r[1].user.id;
      if (document.body) menuConta(sb); else window.addEventListener('DOMContentLoaded', function () { menuConta(sb); });
      return { db: criaDb(sb, uid), assets: criaAssets(sb, uid), sample: criaSample(), mcp: criaMcp() };
    });
    return servicos;
  }

  window.claude = {
    use: function (nome) {
      return prontos().then(function (s) { return s[nome] || null; });
    }
  };

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
})();
