/* ==========================================================================
   Visual Kanban · chat analista ↔ confecção
   ========================================================================== */
(function () {
  "use strict";

  var VK = window.VK;
  if (!VK.$("#threads")) return;

  var ocupado = false;
  var iniciado = false;
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

  function renderMensagens(msgs) {
    var box = VK.$("#messages");
    var perto = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    var meu = (VK.session() || {}).user;

    if (!msgs.length) {
      box.innerHTML = '<div class="vazio" style="border:none;margin:auto;font-size:12.5px">' +
        "Nenhuma mensagem ainda.<br>Use o campo abaixo para iniciar a conversa.</div>";
      box.dataset.iniciado = "1";
      return;
    }

    var html = "";
    var diaAnterior = "";

    msgs.forEach(function (m) {
      var dia = diaLocal(m.data);
      if (dia !== diaAnterior) {
        html += '<div class="dia-sep">' + VK.esc(rotuloDia(m.data)) + "</div>";
        diaAnterior = dia;
      }
      var minha = m.de === meu;
      html += '<div class="msg ' + (minha ? "mine" : "theirs") + '">' +
        '<div class="balao">' + VK.esc(m.mensagem) + "</div>" +
        '<div class="meta">' +
        (minha ? "Você" : VK.esc(m.de_nome || m.de)) + " · " + hora(m.data) +
        "</div></div>";
    });

    box.innerHTML = html;

    if (perto || box.dataset.iniciado !== "1") {
      box.scrollTop = box.scrollHeight;
      box.dataset.iniciado = "1";
    }
  }

  function carregarMensagens(silencioso) {
    var codigo = codigoAtual();
    if (!codigo) { renderMensagens([]); return Promise.resolve(); }
    if (ocupado) return Promise.resolve();
    ocupado = true;

    return VK.call("listarmensagens", { codigo_confeccao: codigo })
      .then(function (r) {
        if (codigo !== codigoAtual()) return null;
        renderMensagens(r.mensagens || []);
        return VK.call("marcarlidas", { codigo_confeccao: codigo });
      })
      .then(function () {
        VK.atualizarBadges();
      })
      .catch(function (e) {
        if (!silencioso) VK.toast(e.message, "error");
      })
      .then(function () { ocupado = false; });
  }

  function selecionar(codigo) {
    if (!codigo) return;
    VK.state.thread = codigo;
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
        otimista.classList.remove("pendente");
        var meta = otimista.querySelector(".meta");
        if (meta) meta.textContent = "Você · " + hora(new Date().toISOString());
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

  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    if (VK.state.tab !== "chat") return;
    if (!codigoAtual()) return;
    carregarMensagens(true);
  }, VK.config.chatPollMs);
})();
