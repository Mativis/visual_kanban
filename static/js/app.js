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
    var analista = s.perfil === "Analista";
    var conf = analista
      ? "Acesso a todas as confecções"
      : (s.nome_confeccao || "Confecção não vinculada");

    VK.$$('[data-user="nome"]').forEach(function (el) { el.textContent = nome; });
    VK.$$('[data-user="avatar"]').forEach(function (el) { el.textContent = VK.iniciais(nome); });
    VK.$$('[data-user="conf"]').forEach(function (el) { el.textContent = conf; });
    VK.$$('[data-user="role"]').forEach(function (el) {
      el.textContent = s.perfil || "";
      el.className = "role " + (analista ? "Analista" : "Confecção");
    });

    var versao = VK.nativo
      ? (VK.webVersao || VK.appVersao || (VK.config && VK.config.versao))
      : (VK.config && VK.config.versao);
    VK.$$('[data-user="versao"]').forEach(function (el) {
      el.textContent = versao || "—";
    });

    var brandSub = VK.$("#brand-sub");
    if (brandSub) brandSub.textContent = analista ? "visão analista" : "visão confecção";

    VK.$$("[data-admin]").forEach(function (el) {
      el.classList.toggle("hide", !analista);
    });
    var fConf = VK.$("#f-conf");
    if (fConf) fConf.classList.toggle("hide", !analista);
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

  var NOMES_TIPO = {
    atrasado: "Atrasado",
    vence: "Vence em breve",
    prioridade: "Prioridade alta",
    sem_confeccao: "Sem confecção",
  };

  function idAlerta(a) {
    return String(a.chave || "") + "|" + String(a.tipo || "");
  }

  function alertaPorId(id) {
    var lista = VK.state.alertas || [];
    for (var i = 0; i < lista.length; i++) {
      if (idAlerta(lista[i]) === id) return lista[i];
    }
    return null;
  }

  function masterDetailAlertas() {
    return !!(window.matchMedia && window.matchMedia("(min-width: 1100px)").matches);
  }

  function abrirNoKanban(chave, codigo) {
    if (codigo && VK.ehAnalista() && VK.state.filtros.confeccao !== codigo) {
      VK.state.filtros.confeccao = codigo;
      var sel = VK.$("#f-conf");
      if (sel) sel.value = codigo;
    }
    VK.nav("kanban");
    if (chave && VK.kanban && VK.kanban.abrirPedido) VK.kanban.abrirPedido(chave);
  }

  function renderDetalheAlerta() {
    var painel = VK.$("#alert-detail");
    if (!painel) return;

    var a = alertaPorId(VK.state.alertaSel || "");
    if (!a) {
      painel.className = "alert-detail";
      painel.innerHTML = '<div class="ad-vazio"><span class="big">⚠</span>' +
        (VK.state.alertaSel
          ? "Este alerta saiu da lista."
          : "Selecione um alerta para ver os detalhes.") +
        "</div>";
      return;
    }

    var sev = Number(a.severidade) || 1;
    var tipo = NOMES_TIPO[a.tipo] || "Alerta";
    var st = a.status || "—";
    var pillClass = st === "Em andamento" ? "Média" : st;
    var prazo = VK.dataBR(a.dt_entrega);

    if (a.dias !== null && a.dias !== "" && !isNaN(Number(a.dias))) {
      var dias = Number(a.dias);
      if (dias < 0) prazo += " · atrasado há " + Math.abs(dias) + " dia(s)";
      else if (dias === 0) prazo += " · entrega hoje";
      else prazo += " · faltam " + dias + " dia(s)";
    }

    painel.className = "alert-detail sev-" + sev;
    painel.innerHTML =
      '<div class="ad-head">' +
        '<div class="ad-ico">' + (ICONES[a.tipo] || "•") + "</div>" +
        "<div><h3>" + VK.esc(a.titulo || tipo) + "</h3>" +
          '<div class="ad-sub">Pedido #' + VK.esc(a.pedido || "—") +
            " · Cód " + VK.esc(a.cod_confec || "—") + "</div>" +
          '<span class="ad-sev">' + VK.esc(tipo) + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="detalhe">' +
        '<div class="item"><span>Confecção</span><strong>' +
          VK.esc(a.confeccao || "Sem confecção") + "</strong></div>" +
        '<div class="item"><span>Código de vínculo</span><strong>' +
          VK.esc(a.codigo_confeccao || "—") + "</strong></div>" +
        '<div class="item"><span>Entrega</span><strong>' + VK.esc(prazo) + "</strong></div>" +
        '<div class="item"><span>Status</span><strong><span class="pill ' +
          VK.esc(pillClass) + '">' + VK.esc(st) + "</span></strong></div>" +
        '<div class="item" style="grid-column:1/-1"><span>Detalhe</span><strong>' +
          VK.esc(a.detalhe || "—") + "</strong></div>" +
      "</div>" +
      '<div class="ad-actions">' +
        '<button class="btn primary" type="button" data-abrir="1">Abrir no Kanban</button>' +
      "</div>";
  }

  // Um único listener: o conteúdo de #alerts-list é recriado a cada render.
  VK.on(VK.$("#alerts-list"), "click", ".alerta", function (ev, el) {
    if (masterDetailAlertas()) {
      VK.state.alertaSel = el.getAttribute("data-sel") || "";
      VK.alertas.render();
      return;
    }
    abrirNoKanban(el.getAttribute("data-chave"), el.getAttribute("data-codigo"));
  });

  VK.on(VK.$("#alert-detail"), "click", "[data-abrir]", function () {
    var a = alertaPorId(VK.state.alertaSel || "");
    if (a) abrirNoKanban(a.chave, a.codigo_confeccao);
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

      if (VK.state.alertaSel && !alertaPorId(VK.state.alertaSel)) {
        VK.state.alertaSel = "";
      }
      if (masterDetailAlertas() && !VK.state.alertaSel && lista.length) {
        VK.state.alertaSel = idAlerta(lista[0]);
      }

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
        renderDetalheAlerta();
        return;
      }

      box.innerHTML = lista.map(function (a) {
        var sev = Number(a.severidade) || 1;
        var sel = idAlerta(a);
        return '<div class="alerta sev-' + sev +
          (masterDetailAlertas() && sel === VK.state.alertaSel ? " ativo" : "") +
          '" data-sel="' + VK.esc(sel) + '" data-chave="' + VK.esc(a.chave) + '" ' +
          'data-codigo="' + VK.esc(a.codigo_confeccao || "") + '">' +
          '<div class="ico">' + (ICONES[a.tipo] || "•") + "</div>" +
          '<div class="corpo"><strong>#' + VK.esc(a.pedido) + " · " + VK.esc(a.titulo) + "</strong>" +
          "<span>Cód " + VK.esc(a.cod_confec || "—") + " · " + VK.esc(a.confeccao || "Sem confecção") +
          " · " + VK.esc(a.detalhe || "") + "</span></div>" +
          '<div class="lado">' + VK.esc(VK.dataBR(a.dt_entrega)) + "<br>" +
          '<span class="pill ' + VK.esc(a.status === "Em andamento" ? "Média" : a.status) + '">' +
          VK.esc(a.status) + "</span></div></div>";
      }).join("");

      renderDetalheAlerta();
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
      VK.state.alertaSel = "";
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
      VK.state.alertaSel = "";
      VK.state.alertasLimpos = 0;
      VK.setBadge("badge-alertas", VK.state.alertas.length);
      VK.alertas.render();
      VK.toast("Alertas restaurados.", "ok", 1800);
    },
  };

  /* ---------------- Navegação ---------------- */

  var TITULOS = {
    kanban: "Kanban",
    chat: "Chat",
    alertas: "Alertas",
    admin: "Administração",
  };

  function fecharDrawer() {
    var drawer = VK.$("#drawer");
    var scrim = VK.$("#drawer-scrim");
    var btn = VK.$("#btn-menu");
    if (drawer) {
      drawer.classList.remove("open");
      drawer.setAttribute("aria-hidden", "true");
    }
    if (scrim) scrim.classList.add("hide");
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("drawer-aberto");
  }
  VK.fecharDrawer = fecharDrawer;

  function abrirDrawer() {
    var drawer = VK.$("#drawer");
    if (!drawer) return;
    var scrim = VK.$("#drawer-scrim");
    var btn = VK.$("#btn-menu");
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    if (scrim) scrim.classList.remove("hide");
    if (btn) btn.setAttribute("aria-expanded", "true");
    document.body.classList.add("drawer-aberto");
  }
  VK.abrirDrawer = abrirDrawer;

  function fecharMenus() {
    var menu = VK.$("#user-dropdown");
    if (menu) menu.classList.add("hide");
    fecharDrawer();
    VK.fecharDialogo("dlg-mais");
  }

  VK.nav = function (tab) {
    if (tab === "admin" && !VK.ehAnalista()) tab = "kanban";
    if (["kanban", "chat", "alertas", "admin"].indexOf(tab) < 0) tab = "kanban";

    VK.state.tab = tab;

    VK.$$("[data-tab]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    var btnMais = VK.$("#btn-mais");
    if (btnMais) btnMais.classList.toggle("active", tab === "admin");

    VK.$$(".view").forEach(function (v) { v.classList.add("hide"); });

    var view = VK.$("#view-" + tab);
    if (view) view.classList.remove("hide");

    var titulo = VK.$("#topbar-title");
    if (titulo) titulo.textContent = TITULOS[tab] || "Kanban";

    if (window.history && history.replaceState) history.replaceState(null, "", "#" + tab);

    fecharMenus();

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
    VK.state.versaoDados = "";
    VK.state.versaoEscopo = "";
    if (VK.cacheLocal) VK.cacheLocal.limpar();
    VK.atualizarBadges();
    if (VK.state.tab === "kanban") VK.kanban.carregar(false, true);
    if (VK.state.tab === "admin") VK.admin.abrir();
  };

  /* ---------------- Eventos ---------------- */

  function executarConta(act) {
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
  }

  function ligarEventos() {
    // Navegação: gaveta, barra inferior e folha "Mais".
    document.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-tab]") : null;
      if (!el) return;
      var tab = el.getAttribute("data-tab");
      if (tab) VK.nav(tab);
    });

    window.addEventListener("hashchange", function () {
      var tab = (location.hash || "").replace("#", "");
      if (tab && tab !== VK.state.tab) VK.nav(tab);
    });

    // Gaveta lateral (desktop).
    var btnMenu = VK.$("#btn-menu");
    var drawer = VK.$("#drawer");
    if (btnMenu && drawer) {
      btnMenu.addEventListener("click", function () {
        if (drawer.classList.contains("open")) fecharDrawer();
        else abrirDrawer();
      });
    }
    var scrim = VK.$("#drawer-scrim");
    if (scrim) scrim.addEventListener("click", fecharDrawer);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") fecharDrawer();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth <= 760) fecharDrawer();
    });

    // Barra inferior: "Mais".
    var btnMais = VK.$("#btn-mais");
    if (btnMais) {
      btnMais.addEventListener("click", function () {
        VK.abrirDialogo("dlg-mais");
      });
    }

    // Menu do usuário (desktop) ou folha "Mais" (celular).
    var menu = VK.$("#user-dropdown");
    var btnUser = VK.$("#btn-user");
    if (menu && btnUser) {
      btnUser.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (window.matchMedia && window.matchMedia("(max-width: 760px)").matches) {
          VK.abrirDialogo("dlg-mais");
          return;
        }
        menu.classList.toggle("hide");
      });
      document.addEventListener("click", function (ev) {
        if (!menu.contains(ev.target)) menu.classList.add("hide");
      });
    }

    // Ações de conta em qualquer menu (dropdown, gaveta ou folha "Mais").
    // A verificação de OTA é tratada pelo native.js no app Android.
    document.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!el) return;
      var act = el.getAttribute("data-act");
      if (!act || act === "verificar-ota") return;
      fecharMenus();
      executarConta(act);
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
