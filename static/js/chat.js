/* ==========================================================================
   Visual Kanban · chat analista ↔ confecção
   ========================================================================== */
(function () {
  "use strict";

  var VK = window.VK;
  if (!VK.$("#threads")) return;

  var ocupado = false;
  var iniciado = false;

  // Cursor da conversa: em qual linha da aba Chat o cliente parou.
  var estado = {
    codigo: "",
    cursor: 0,
    total: 0,
    ids: {},
    modo: VK.config.chatSync === false ? "antigo" : "sync",
    pendente: false,
  };
  function codigoAtual() {
    if (!VK.ehAnalista()) {
      return (VK.session() || {}).codigo_confeccao || "";
    }
    return VK.state.thread || "";
  }

  function infoThread(codigo) {
    var achou = null;
    (VK.state.resumo || []).forEach(function (c) {
      if (c.codigo === codigo) achou = c;
    });
    return achou;
  }

  function diaLocal(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || "").slice(0, 10);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  function rotuloDia(iso) {
    var dia = diaLocal(iso);
    if (!dia) return "";
    var hoje = new Date();
    var ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    var local = function (d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");
    };
    if (dia === local(hoje)) return "Hoje";
    if (dia === local(ontem)) return "Ontem";
    return VK.dataBR(dia);
  }

  function hora(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------------- Threads ---------------- */

  function renderThreads() {
    var box = VK.$("#threads");
    if (!box) return;

    var filtro = (VK.$("#f-thread").value || "").toLowerCase();
    var lista;

    if (VK.ehAnalista()) {
      lista = (VK.state.resumo || []).filter(function (c) {
        return !filtro || String(c.nome).toLowerCase().indexOf(filtro) >= 0 ||
          String(c.codigo).toLowerCase().indexOf(filtro) >= 0;
      });
    } else {
      var s = VK.session() || {};
      lista = [{
        codigo: s.codigo_confeccao || "",
        nome: s.nome_confeccao || "Minha confecção",
        total: (VK.state.pedidos || []).length,
        pecas: (VK.state.pedidos || []).reduce(function (a, p) { return a + (Number(p.saldo) || 0); }, 0),
      }];
    }

    VK.$("#threads-count").textContent = lista.length ? lista.length + " confecção(ões)" : "";

    if (!lista.length) {
      box.innerHTML = '<div class="vazio" style="border:none;padding:26px 10px;font-size:12.5px">' +
        "Nenhuma confecção encontrada.</div>";
      return;
    }

    var atual = codigoAtual();

    box.innerHTML = lista.map(function (c) {
      var naoLidas = (VK.state.naoLidasPor || {})[c.codigo] || 0;
      return '<button type="button" class="thread' + (c.codigo === atual ? " active" : "") + '"' +
        ' data-codigo="' + VK.esc(c.codigo) + '">' +
        '<span class="avatar">' + VK.esc(VK.iniciais(c.nome)) + "</span>" +
        '<span class="info"><strong>' + VK.esc(c.nome) + "</strong>" +
        "<small>" + VK.num(c.total || 0) + " pedidos" +
        (c.pecas !== undefined ? " · " + VK.num(c.pecas) + " un" : "") + "</small></span>" +
        (naoLidas ? '<span class="novo">' + (naoLidas > 99 ? "99+" : naoLidas) + "</span>" : "") +
        "</button>";
    }).join("");
  }

  /* ---------------- Conversa ---------------- */

  function atualizarCabecalho() {
    var codigo = codigoAtual();
    var info = infoThread(codigo);
    var s = VK.session() || {};

    var nome = VK.ehAnalista()
      ? (info ? info.nome : "Selecione uma conversa")
      : (s.nome_confeccao || "Minha confecção");

    VK.$("#conv-nome").textContent = nome;
    VK.$("#conv-avatar").textContent = VK.iniciais(nome);

    if (VK.ehAnalista() && !codigo) {
      VK.$("#conv-sub").textContent = "Escolha uma confecção na lista ao lado.";
    } else {
      var total = info
        ? info.total
        : (!VK.ehAnalista() ? (VK.state.pedidos || []).length : 0);
      var pecas = info && info.pecas !== undefined
        ? info.pecas
        : (VK.state.pedidos || []).reduce(function (a, p) { return a + (Number(p.saldo) || 0); }, 0);
      VK.$("#conv-sub").textContent =
        total + " pedido(s) · " + VK.num(pecas) + " un · vínculo " + (codigo || "—");
    }
  }

  function htmlMensagem(m, meu, diaAnterior) {
    var html = "";
    var dia = diaLocal(m.data);
    if (dia !== diaAnterior) {
      html += '<div class="dia-sep">' + VK.esc(rotuloDia(m.data)) + "</div>";
    }
    var minha = m.de === meu;
    html += '<div class="msg ' + (minha ? "mine" : "theirs") + '">' +
      '<div class="balao">' + VK.esc(m.mensagem) + "</div>" +
      '<div class="meta">' +
      (minha ? "Você" : VK.esc(m.de_nome || m.de)) + " · " + hora(m.data) +
      "</div></div>";
    return { html: html, dia: dia };
  }

  /**
   * `anexar = true` só insere as mensagens novas no fim. Recriar o innerHTML a
   * cada poll de 8s perdia seleção de texto e forçava o navegador a refazer
   * layout de toda a conversa.
   */
  function renderMensagens(msgs, anexar) {
    var box = VK.$("#messages");
    var perto = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    var meu = (VK.session() || {}).user;

    if (!msgs.length && !anexar) {
      box.innerHTML = '<div class="vazio" style="border:none;margin:auto;font-size:12.5px">' +
        "Nenhuma mensagem ainda.<br>Use o campo abaixo para iniciar a conversa.</div>";
      box.dataset.iniciado = "1";
      box.dataset.dia = "";
      return;
    }

    var diaAnterior = anexar ? (box.dataset.dia || "") : "";
    var html = "";

    msgs.forEach(function (m) {
      var r = htmlMensagem(m, meu, diaAnterior);
      html += r.html;
      diaAnterior = r.dia;
    });

    if (anexar) {
      var vazio = box.querySelector(".vazio");
      if (vazio) box.removeChild(vazio);
      box.insertAdjacentHTML("beforeend", html);
    } else {
      box.innerHTML = html;
    }
    box.dataset.dia = diaAnterior;

    msgs.forEach(function (m) { if (m.id) estado.ids[m.id] = true; });

    if (perto || anexar || box.dataset.iniciado !== "1") {
      box.scrollTop = box.scrollHeight;
      box.dataset.iniciado = "1";
    }
  }

  function aplicarNaoLidas(r) {
    if (r.nao_lidas === undefined) return;
    VK.state.naoLidas = Number(r.nao_lidas) || 0;
    if (r.nao_lidas_por) VK.state.naoLidasPor = r.nao_lidas_por;
    VK.setBadge("badge-chat", VK.state.naoLidas);
    if (VK.state.tab === "chat") renderThreads();
  }

  /* Caminho antigo (3 chamadas). Só é usado se o servidor não conhecer a
     sincronização incremental ou se config.chatSync = false. */
  function carregarAntigo(silencioso) {
    var codigo = codigoAtual();
    return VK.call("listarmensagens", { codigo_confeccao: codigo })
      .then(function (r) {
        if (codigo !== codigoAtual()) return null;
        renderMensagens(r.mensagens || []);
        return VK.call("marcarlidas", { codigo_confeccao: codigo });
      })
      .then(function () { VK.atualizarBadges(); })
      .catch(function (e) {
        if (!silencioso) VK.toast(e.message, "error");
      });
  }

  /* 1 chamada: delta de mensagens + badge + marcação de leitura. */
  function carregarSync(silencioso, restantes) {
    if (restantes === undefined) restantes = 5;
    var codigo = codigoAtual();
    var inicial = estado.codigo !== codigo || !estado.cursor;

    return VK.call("sincronizarchat", {
      codigo_confeccao: codigo,
      desde_linha: inicial ? 0 : estado.cursor,
      total_linhas: inicial ? 0 : estado.total,
      marcar_lidas: document.visibilityState === "visible",
      limite: 100,
    })
      .then(function (r) {
        if (codigo !== codigoAtual()) return null;

        estado.codigo = codigo;
        estado.cursor = (r.cursor && r.cursor.ultima_linha) || 0;
        estado.total = (r.cursor && r.cursor.total_linhas) || 0;

        var msgs = r.mensagens || [];

        if (r.modo === "completo") {
          estado.ids = {};
          renderMensagens(msgs, false);
        } else {
          var novas = msgs.filter(function (m) {
            return !(m.id && estado.ids[m.id]);
          });
          if (novas.length) renderMensagens(novas, true);
        }

        aplicarNaoLidas(r);

        // Sobrou muita linha para trás: continua agora, sem esperar o poll.
        if (r.tem_mais && restantes > 0) return carregarSync(true, restantes - 1);
        return null;
      })
      .catch(function (e) {
        // Implantação antiga do Apps Script: a ação não existe e o servidor
        // responde "Ação não reconhecida" (sem código). Volta para o caminho
        // de 3 chamadas sem interromper a conversa. Erros passageiros (lock,
        // planilha) continuam tentando o modo novo no próximo poll.
        var semAcao = e && (e.codigo === "ACAO_DESCONHECIDA" ||
          (e.codigo === "ERRO" && /reconhecid/i.test(String(e.message))));
        if (semAcao) {
          estado.modo = "antigo";
          return carregarAntigo(silencioso);
        }
        if (!silencioso) VK.toast(e.message, "error");
      });
  }

  function carregarMensagens(silencioso) {
    var codigo = codigoAtual();
    if (!codigo) { renderMensagens([]); return Promise.resolve(); }
    if (ocupado) { estado.pendente = true; return Promise.resolve(); }
    ocupado = true;

    var tarefa = estado.modo === "sync"
      ? carregarSync(silencioso)
      : carregarAntigo(silencioso);

    var concluir = function () {
      ocupado = false;
      if (estado.pendente) {
        estado.pendente = false;
        setTimeout(function () { carregarMensagens(true); }, 60);
      }
    };
    return tarefa.then(concluir, concluir);
  }

  function selecionar(codigo) {
    if (!codigo) return;
    VK.state.thread = codigo;
    estado.codigo = "";
    estado.cursor = 0;
    estado.total = 0;
    estado.ids = {};
    renderThreads();
    atualizarCabecalho();
    VK.$("#messages").dataset.iniciado = "";
    VK.$("#messages").innerHTML = '<div class="vazio" style="border:none;margin:auto;font-size:12.5px">Carregando…</div>';
    carregarMensagens(false);
    VK.$("#msg-input").focus();
  }

  /* ---------------- Envio ---------------- */

  function enviar() {
    var codigo = codigoAtual();
    var campo = VK.$("#msg-input");
    var texto = campo.value.trim();

    if (!codigo) {
      VK.toast(VK.ehAnalista() ? "Selecione uma confecção." : "Usuário sem confecção vinculada.", "warn");
      return;
    }
    if (!texto) return;

    var botao = VK.$("#btn-enviar-msg");
    botao.disabled = true;
    campo.value = "";
    campo.style.height = "";

    var box = VK.$("#messages");
    var otimista = document.createElement("div");
    otimista.className = "msg mine pendente";
    otimista.innerHTML = '<div class="balao">' + VK.esc(texto) + "</div>" +
      '<div class="meta">enviando…</div>';
    box.appendChild(otimista);
    box.scrollTop = box.scrollHeight;

    VK.call("enviarmensagem", { codigo_confeccao: codigo, mensagem: texto })
      .then(function () {
        // A mensagem real volta pelo sync com id do servidor; manter a bolha
        // otimista faria ela aparecer duas vezes no modo append.
        otimista.remove();
        box.dataset.iniciado = "1";
        box.scrollTop = box.scrollHeight;
        carregarMensagens(true);
      })
      .catch(function (e) {
        otimista.remove();
        campo.value = texto;
        VK.toast(e.message, "error");
      })
      .then(function () {
        botao.disabled = false;
        campo.focus();
      });
  }

  /* ---------------- API pública ---------------- */

  VK.chat = {
    abrir: function () {
      if (!VK.ehAnalista()) {
        var pane = VK.$(".threads-pane");
        if (pane) pane.style.display = "none";
        var layout = VK.$(".chat-layout");
        if (layout) layout.style.gridTemplateColumns = "1fr";
      }

      var s = VK.session() || {};
      if (!VK.ehAnalista() && !s.codigo_confeccao) {
        VK.$("#messages").innerHTML = '<div class="vazio" style="border:none;margin:auto;font-size:12.5px">' +
          "Seu usuário não está vinculado a uma confecção.<br>Peça ao analista para ajustar o cadastro.</div>";
        atualizarCabecalho();
        return;
      }

      var preparar = Promise.resolve();

      if (VK.ehAnalista() && !(VK.state.resumo || []).length) {
        preparar = VK.call("resumo").then(function (r) {
          VK.state.resumo = r.confeccoes || [];
          if (r.ultimo_envio) VK.state.ultimoEnvio = r.ultimo_envio;
        }).catch(function (e) { VK.toast(e.message, "error"); });
      } else if (!VK.ehAnalista() && !(VK.state.pedidos || []).length) {
        preparar = VK.call("listarpedidos").then(function (r) {
          VK.state.pedidos = r.pedidos || [];
          if (r.ultimo_envio) VK.state.ultimoEnvio = r.ultimo_envio;
        }).catch(function () { /* mantém o cabeçalho com os dados da sessão */ });
      }

      preparar.then(function () {
        if (!VK.ehAnalista()) {
          VK.state.thread = s.codigo_confeccao || "";
        } else if (!VK.state.thread && (VK.state.resumo || []).length) {
          VK.state.thread = VK.state.resumo[0].codigo;
        }

        renderThreads();
        atualizarCabecalho();

        if (!iniciado && codigoAtual()) {
          iniciado = true;
          VK.$("#messages").dataset.iniciado = "";
          carregarMensagens(false);
        } else if (!codigoAtual()) {
          renderMensagens([]);
        } else {
          // Reabriu a aba: busca o delta sem esperar o próximo ciclo do poll.
          carregarMensagens(true);
          agendarPoll();
        }
      });
    },

    atualizarBadgesThreads: function () {
      if (VK.$("#threads")) renderThreads();
    },
  };

  /* ---------------- Eventos ---------------- */

  VK.on(VK.$("#threads"), "click", ".thread", function (ev, el) {
    selecionar(el.getAttribute("data-codigo"));
  });

  VK.$("#f-thread").addEventListener("input", renderThreads);

  VK.$("#form-msg").addEventListener("submit", function (ev) {
    ev.preventDefault();
    enviar();
  });

  var campo = VK.$("#msg-input");

  campo.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      enviar();
    }
  });

  campo.addEventListener("input", function () {
    campo.style.height = "auto";
    campo.style.height = Math.min(campo.scrollHeight, 140) + "px";
  });

  VK.$("#btn-chat-atualizar").addEventListener("click", function () {
    carregarMensagens(false);
    VK.toast("Conversa atualizada.", "info", 1500);
  });

  /* ---------------- Polling adaptativo ---------------- */

  var timerPoll = null;

  function pollOcioso() {
    return document.visibilityState !== "visible" || VK.state.tab !== "chat";
  }

  function agendarPoll() {
    if (timerPoll) clearTimeout(timerPoll);
    var espera = pollOcioso() ? VK.config.chatPollOciosoMs : VK.config.chatPollMs;
    timerPoll = setTimeout(function () {
      timerPoll = null;
      if (!pollOcioso() && codigoAtual()) carregarMensagens(true);
      agendarPoll();
    }, espera);
  }

  // Voltar para a aba (ou para o app) atualiza na hora; sair desacelera.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && VK.state.tab === "chat" && codigoAtual()) {
      if (iniciado) carregarMensagens(true);
    }
    agendarPoll();
  });

  agendarPoll();
})();
