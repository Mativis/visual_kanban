/* ==========================================================================
   Visual Kanban · shell do painel (navegação, cabeçalho, alertas, polling)
   ========================================================================== */
(function () {
  "use strict";

  var VK = window.VK;
  if (!VK.$("#view-kanban")) return;

  var sessao = VK.session();
  if (!sessao || !sessao.token) {
    location.replace("index.html");
    return;
  }

  VK.usuario = sessao;

  /* ---------------- Cabeçalho ---------------- */

  function renderUsuario() {
    var s = VK.session() || {};
    var nome = s.nome || s.user || "—";

    VK.$("#user-name").textContent = nome;
    VK.$("#user-avatar").textContent = VK.iniciais(nome);
    VK.$("#dd-nome").textContent = nome;
    VK.$("#dd-conf").textContent = s.perfil === "Analista"
      ? "Acesso a todas as confecções"
      : (s.nome_confeccao || "Confecção não vinculada");

    var role = VK.$("#user-role");
    role.textContent = s.perfil || "";
    role.className = "role " + (s.perfil === "Analista" ? "Analista" : "Confecção");

    VK.$("#brand-sub").textContent = s.perfil === "Analista" ? "visão analista" : "visão confecção";
    VK.$("#tab-admin").classList.toggle("hide", s.perfil !== "Analista");
    VK.$("#f-conf").classList.toggle("hide", s.perfil !== "Analista");
  }

  VK.renderUsuario = renderUsuario;

  function atualizarSync() {
    var el = VK.$("#sync-info");
    if (!el) return;
    el.textContent = VK.state.ultimoEnvio
      ? "Sincronizado " + VK.dataHora(VK.state.ultimoEnvio)
      : "Aguardando envio do Visualfil";
    el.title = VK.state.ultimoEnvio || "Nenhum Kanban enviado ainda";
  }

  function versaoAntiga(versao) {
    var nums = String(versao || "").match(/\d+/g) || [];
    var min = [1, 2, 0];
    for (var i = 0; i < min.length; i++) {
      var n = Number(nums[i] || 0);
      if (n < min[i]) return true;
      if (n > min[i]) return false;
    }
    return false;
  }

  function verificarServidor() {
    var box = VK.$("#aviso-conexao");
    if (!box) return;

    VK.call("ping", {}, { timeout: 15000 })
      .then(function (r) {
        var versaoEl = VK.$("#dd-versao");
        if (versaoEl) versaoEl.textContent = r && r.versao ? "Servidor " + r.versao : "";
        if (!r || !versaoAntiga(r.versao)) {
          box.classList.add("hide");
          return;
        }
        box.innerHTML = "<span><strong>Servidor antigo conectado" +
          (r.versao ? " (versão " + VK.esc(r.versao) + ")" : "") +
          ".</strong> A quebra de tecido só aparece com a versão 1.2.0 do Apps Script. " +
          "Atualize a conexão e recarregue o painel.</span>" +
          '<button type="button" class="btn ghost sm" id="btn-conexao-atualizar">Atualizar painel</button>';
        box.classList.remove("hide");

        var btn = VK.$("#btn-conexao-atualizar");
        if (btn) btn.addEventListener("click", function () {
          if (VK.config.apiUrlPadrao) VK.setApiUrl(VK.config.apiUrlPadrao);
          location.href = location.pathname + "?v=" + Date.now() + (location.hash || "");
        });
      })
      .catch(function () { /* não bloqueia o painel se o ping falhar */ });
  }

  VK.verificarServidor = verificarServidor;

  VK.atualizarSessao = function () {
    return VK.call("sessao")
      .then(function (r) {
        var u = r.usuario || {};
        VK.patchSession({
          nome: u.nome,
          perfil: u.perfil,
          codigo_confeccao: u.codigo_confeccao || "",
          nome_confeccao: u.nome_confeccao || "",
        });
        VK.usuario = VK.session();
        renderUsuario();
      })
      .catch(function () { /* sessão inválida já redireciona */ });
  };

  /* ---------------- Alertas / badges ---------------- */

  var LS_ALERTAS_LIMPOS = "vk_alertas_limpos";

  function usuarioAlerta() {
    var s = VK.session() || {};
    return String(s.user || s.nome || "anon");
  }

  /**
   * Identifica o alerta pela situação que o gerou. Se o pedido mudar de
   * status, prazo ou confecção, a chave muda e o alerta volta a aparecer.
   */
  function chaveDispensa(a) {
    return [
      a.chave,
      a.tipo,
      a.dt_entrega || "",
      a.status || "",
      a.codigo_confeccao || "",
    ].join("|");
  }

  function lerAlertasLimpos() {
    try {
      var tudo = JSON.parse(localStorage.getItem(LS_ALERTAS_LIMPOS) || "{}");
      var lista = tudo && tudo[usuarioAlerta()];
      return Array.isArray(lista) ? lista : [];
    } catch (e) {
      return [];
    }
  }

  function gravarAlertasLimpos(lista) {
    try {
      var tudo;
      try { tudo = JSON.parse(localStorage.getItem(LS_ALERTAS_LIMPOS) || "{}"); }
      catch (e) { tudo = {}; }
      if (!tudo || typeof tudo !== "object") tudo = {};
      var usuario = usuarioAlerta();
      if (lista && lista.length) tudo[usuario] = lista;
      else delete tudo[usuario];
      localStorage.setItem(LS_ALERTAS_LIMPOS, JSON.stringify(tudo));
    } catch (e) {
      // armazenamento indisponível: a limpeza vale só para esta sessão
    }
  }

  VK.atualizarBadges = function () {
    return VK.call("notificacoes")
      .then(function (r) {
        var todos = r.alertas || [];
        var limpos = lerAlertasLimpos();

        // Descarta chaves de alertas que já saíram do quadro, para que uma
        // ocorrência futura da mesma situação volte a ser exibida.
        var atuais = {};
        todos.forEach(function (a) { atuais[chaveDispensa(a)] = true; });
        var mantidos = limpos.filter(function (k) { return atuais[k]; });
        if (mantidos.length !== limpos.length) gravarAlertasLimpos(mantidos);

        VK.state.alertasTodos = todos;
        VK.state.alertas = todos.filter(function (a) {
          return mantidos.indexOf(chaveDispensa(a)) < 0;
        });
        VK.state.alertasLimpos = todos.length - VK.state.alertas.length;
        VK.state.naoLidas = r.nao_lidas || 0;
        VK.state.naoLidasPor = r.nao_lidas_por || VK.state.naoLidasPor;
        if (r.ultimo_envio) VK.state.ultimoEnvio = r.ultimo_envio;

        VK.setBadge("badge-chat", VK.state.naoLidas);
        VK.setBadge("badge-alertas", VK.state.alertas.length);
        atualizarSync();

        if (VK.state.tab === "alertas") VK.alertas.render();
        if (VK.state.tab === "chat" && VK.chat.atualizarBadgesThreads) {
          VK.chat.atualizarBadgesThreads();
        }
        return r;
      })
      .catch(function () { return null; });
  };

  var ICONES = {
    atrasado: "⏰",
    vence: "📅",
    prioridade: "🔥",
    sem_confeccao: "🏭",
  };

  // Um único listener: o conteúdo de #alerts-list é recriado a cada render.
  VK.on(VK.$("#alerts-list"), "click", ".alerta", function (ev, el) {
    var chave = el.getAttribute("data-chave");
    var codigo = el.getAttribute("data-codigo");
    if (codigo && VK.ehAnalista() && VK.state.filtros.confeccao !== codigo) {
      VK.state.filtros.confeccao = codigo;
      var sel = VK.$("#f-conf");
      if (sel) sel.value = codigo;
    }
    VK.nav("kanban");
    if (chave && VK.kanban && VK.kanban.abrirPedido) VK.kanban.abrirPedido(chave);
  });

  VK.on(VK.$("#alerts-list"), "click", ".btn-restaurar-alertas", function (ev) {
    ev.stopPropagation();
    VK.alertas.restaurar();
  });

  VK.alertas = {
    render: function () {
      var box = VK.$("#alerts-list");
      if (!box) return;
      var lista = VK.state.alertas || [];

      if (!lista.length) {
        var limpos = VK.state.alertasLimpos || 0;
        var textoLimpos = limpos === 1
          ? "1 alerta limpo"
          : limpos + " alertas limpos";
        box.innerHTML = '<div class="vazio"><span class="big">✓</span>' +
          "Nenhum alerta no momento. Tudo em dia com os prazos!" +
          (limpos
            ? '<div class="vazio-acao"><button type="button" ' +
              'class="btn ghost sm btn-restaurar-alertas">Mostrar ' + textoLimpos +
              "</button></div>"
            : "") +
          "</div>";
        return;
      }

      box.innerHTML = lista.map(function (a) {
        var sev = Number(a.severidade) || 1;
        return '<div class="alerta sev-' + sev + '" data-chave="' + VK.esc(a.chave) + '" ' +
          'data-codigo="' + VK.esc(a.codigo_confeccao || "") + '">' +
          '<div class="ico">' + (ICONES[a.tipo] || "•") + "</div>" +
          '<div class="corpo"><strong>#' + VK.esc(a.pedido) + " · " + VK.esc(a.titulo) + "</strong>" +
          "<span>Cód " + VK.esc(a.cod_confec || "—") + " · " + VK.esc(a.confeccao || "Sem confecção") +
          " · " + VK.esc(a.detalhe || "") + "</span></div>" +
          '<div class="lado">' + VK.esc(VK.dataBR(a.dt_entrega)) + "<br>" +
          '<span class="pill ' + VK.esc(a.status === "Em andamento" ? "Média" : a.status) + '">' +
          VK.esc(a.status) + "</span></div></div>";
      }).join("");
    },

    abrir: function () {
      VK.alertas.render();
      VK.atualizarBadges();
    },

    limpar: function () {
      var visiveis = VK.state.alertas || [];
      if (!visiveis.length) {
        VK.toast("Nenhum alerta para limpar.", "info", 1800);
        return;
      }

      var mapa = {};
      lerAlertasLimpos().forEach(function (k) { mapa[k] = true; });
      visiveis.forEach(function (a) { mapa[chaveDispensa(a)] = true; });
      gravarAlertasLimpos(Object.keys(mapa));

      VK.state.alertas = [];
      VK.state.alertasLimpos = (VK.state.alertasTodos || []).length;
      VK.setBadge("badge-alertas", 0);
      VK.alertas.render();

      VK.toast(visiveis.length === 1
        ? "1 alerta limpo. Ele volta se a situação mudar."
        : visiveis.length + " alertas limpos. Eles voltam se a situação mudar.", "ok");
    },

    restaurar: function () {
      gravarAlertasLimpos([]);
      VK.state.alertas = (VK.state.alertasTodos || []).slice();
      VK.state.alertasLimpos = 0;
      VK.setBadge("badge-alertas", VK.state.alertas.length);
      VK.alertas.render();
      VK.toast("Alertas restaurados.", "ok", 1800);
    },
  };

  /* ---------------- Navegação ---------------- */

  VK.nav = function (tab) {
    if (tab === "admin" && !VK.ehAnalista()) tab = "kanban";
    if (["kanban", "chat", "alertas", "admin"].indexOf(tab) < 0) tab = "kanban";

    VK.state.tab = tab;

    VK.$$(".tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    VK.$$(".view").forEach(function (v) { v.classList.add("hide"); });

    var view = VK.$("#view-" + tab);
    if (view) view.classList.remove("hide");

    if (window.history && history.replaceState) history.replaceState(null, "", "#" + tab);

    if (tab === "kanban") VK.kanban.abrir();
    else if (tab === "chat") VK.chat.abrir();
    else if (tab === "alertas") VK.alertas.abrir();
    else if (tab === "admin") VK.admin.abrir();
  };

  /** Recarrega dados derivados (usado após mudanças administrativas). */
  VK.recarregarTudo = function () {
    VK.state.resumo = [];
    VK.state.pedidos = [];
    VK.state.thread = "";
    VK.atualizarBadges();
    if (VK.state.tab === "kanban") VK.kanban.carregar(false);
    if (VK.state.tab === "admin") VK.admin.abrir();
  };

  /* ---------------- Eventos ---------------- */

  function ligarEventos() {
    VK.on(VK.$("#tabs"), "click", ".tab", function (ev, el) {
      VK.nav(el.getAttribute("data-tab"));
    });

    window.addEventListener("hashchange", function () {
      var tab = (location.hash || "").replace("#", "");
      if (tab && tab !== VK.state.tab) VK.nav(tab);
    });

    // Menu do usuário
    var menu = VK.$("#user-dropdown");
    VK.$("#btn-user").addEventListener("click", function (ev) {
      ev.stopPropagation();
      menu.classList.toggle("hide");
    });
    document.addEventListener("click", function (ev) {
      if (!menu.contains(ev.target)) menu.classList.add("hide");
    });
    VK.on(menu, "click", "button", function (ev, el) {
      menu.classList.add("hide");
      var act = el.getAttribute("data-act");
      if (act === "senha") {
        VK.$("#form-senha").reset();
        VK.$("#senha-msg").textContent = "";
        VK.abrirDialogo("dlg-senha");
      } else if (act === "conexao") {
        VK.$("#conexao-url").value = VK.config.apiUrl || "";
        VK.$("#conexao-msg").textContent = "";
        VK.abrirDialogo("dlg-conexao");
      } else if (act === "sair") {
        VK.call("logout").catch(function () { }).then(function () {
          VK.logoutLocal();
          location.replace("index.html");
        });
      }
    });

    // Trocar senha
    VK.$("#form-senha").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var msg = VK.$("#senha-msg");
      var atual = VK.$("#senha-atual").value;
      var nova = VK.$("#senha-nova").value;
      var conf = VK.$("#senha-conf").value;

      msg.style.color = "#fca5a5";
      if (nova !== conf) { msg.textContent = "A confirmação não confere."; return; }
      if (nova.length < 6) { msg.textContent = "A nova senha deve ter ao menos 6 caracteres."; return; }

      VK.call("trocarsenha", { senha_atual: atual, nova_senha: nova })
        .then(function () {
          VK.fecharDialogo("dlg-senha");
          VK.toast("Senha alterada com sucesso.", "ok");
        })
        .catch(function (e) { msg.textContent = e.message; });
    });

    // Atualizar alertas
    VK.$("#btn-alertas-limpar").addEventListener("click", function () {
      VK.alertas.limpar();
    });
    VK.$("#btn-alertas-atualizar").addEventListener("click", function () {
      VK.atualizarBadges();
      VK.toast("Alertas atualizados.", "info", 1800);
    });

    // Atalho: fechar diálogos com Esc já é nativo; clique no backdrop fecha
    VK.$$("dialog").forEach(function (d) {
      d.addEventListener("click", function (ev) {
        if (ev.target === d) d.close();
      });
    });
  }

  /* ---------------- Inicialização ---------------- */

  document.addEventListener("DOMContentLoaded", function () {
    renderUsuario();
    VK.iniciarDialogoConexao();
    ligarEventos();
    atualizarSync();

    var inicial = (location.hash || "").replace("#", "") || "kanban";
    VK.nav(inicial);
    VK.atualizarSessao();
    VK.atualizarBadges();
    verificarServidor();

    // Alertas/chat mudam devagar: consulta os badges com menos frequência que
    // o quadro, para poupar chamadas ao Apps Script.
    var badgePollMs = Math.max(VK.config.pollMs * 3, 60000);
    setInterval(function () {
      if (document.visibilityState !== "visible") return;
      VK.atualizarBadges();
    }, badgePollMs);

    setInterval(function () {
      if (document.visibilityState !== "visible") return;
      if (VK.state.tab === "kanban") VK.kanban.silencioso();
    }, VK.config.pollMs);

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      VK.atualizarBadges();
      if (VK.state.tab === "kanban") VK.kanban.silencioso();
    });
  });
})();
