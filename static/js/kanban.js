/* ==========================================================================
   Visual Kanban · quadro (filtros, drag & drop, detalhe, exportação)
   ========================================================================== */
(function () {
  "use strict";

  var VK = window.VK;
  if (!VK.$("#board")) return;

  var COLUNAS = [
    { id: "Pendente", rotulo: "A produzir", cor: "#38bdf8" },
    { id: "Em andamento", rotulo: "Em produção", cor: "#f59e0b" },
    { id: "Pronto", rotulo: "Pronto", cor: "#10b981" },
    { id: "Entregue", rotulo: "Entregue", cor: "#64748b" },
  ];

  var TRANSICOES = {
    "Pendente": ["Em andamento"],
    "Em andamento": ["Pendente", "Pronto"],
    "Pronto": ["Em andamento", "Entregue"],
    "Entregue": ["Pronto"],
  };

  var ROTULO_MOV = {
    "Pendente": "← Voltar para A produzir",
    "Em andamento": "→ Iniciar produção",
    "Pronto": "✓ Marcar como pronto",
    "Entregue": "📦 Confirmar entrega",
  };

  if (!VK.state.mostrar) VK.state.mostrar = {};
  if (!VK.state.carregando) VK.state.carregando = null;

  var parcialChave = "";

  /* ---------------- Permissões ---------------- */

  function movimentos(p) {
    var alvos = (TRANSICOES[p.status] || []).slice();
    if (!VK.ehAnalista()) {
      alvos = alvos.filter(function (s) { return s !== "Entregue"; });
    }
    return alvos;
  }

  function podeParcial(p) {
    return (Number(p.saldo) || 0) > 0 &&
      (p.status === "Pendente" || p.status === "Em andamento");
  }

  function progressoHtml(p) {
    var saldo = Math.max(0, Number(p.saldo) || 0);
    var pronta = Math.min(Math.max(0, Number(p.qtd_pronta) || 0), saldo);
    if (!pronta || p.status === "Pronto" || p.status === "Entregue") return "";
    var pct = saldo ? Math.round((pronta / saldo) * 100) : 0;
    return '<div class="progresso-parcial" title="' +
      VK.esc(VK.num(pronta) + " de " + VK.num(saldo) + " peças prontas") + '">' +
      '<div class="barra"><span style="width:' + pct + '%"></span></div>' +
      '<small>◐ ' + VK.num(pronta) + " de " + VK.num(saldo) + " prontas</small></div>";
  }

  /* ---------------- Carregamento ---------------- */

  function preencherConfeccoes() {
    var sel = VK.$("#f-conf");
    if (!sel || !VK.ehAnalista()) return;

    var total = VK.state.resumo.reduce(function (s, c) { return s + (Number(c.total) || 0); }, 0);
    var html = '<option value="">Todas as confecções · ' + VK.num(total) + " pedidos</option>";
    VK.state.resumo.forEach(function (c) {
      html += '<option value="' + VK.esc(c.codigo) + '">' +
        VK.esc(c.nome) + " · " + VK.num(c.total) + " pedidos</option>";
    });
    sel.innerHTML = html;
    sel.value = VK.state.filtros.confeccao || "";
  }

  function sincronizado() {
    var el = VK.$("#sync-info");
    if (!el) return;
    el.textContent = VK.state.ultimoEnvio
      ? "Sincronizado " + VK.dataHora(VK.state.ultimoEnvio)
      : "Aguardando envio do Visualfil";
  }

  function carregar(mostrarErro, forcar) {
    if (VK.state.carregando) {
      if (!forcar) return VK.state.carregando;
      // Espera a requisição em andamento e busca de novo (ex.: após mover um cartão).
      return VK.state.carregando.then(function () { return carregar(mostrarErro, false); });
    }

    var p = Promise.resolve();

    if (VK.ehAnalista() && !VK.state.resumo.length) {
      p = p.then(function () { return VK.call("resumo"); })
        .then(function (r) {
          VK.state.resumo = r.confeccoes || [];
          if (r.ultimo_envio) VK.state.ultimoEnvio = r.ultimo_envio;
          preencherConfeccoes();
        });
    }

    p = p.then(function () {
      var payload = {};
      if (VK.ehAnalista() && VK.state.filtros.confeccao) {
        payload.codigo_confeccao = VK.state.filtros.confeccao;
      }
      return VK.call("listarpedidos", payload);
    }).then(function (r) {
      VK.state.pedidos = r.pedidos || [];
      if (r.ultimo_envio) VK.state.ultimoEnvio = r.ultimo_envio;
      sincronizado();
      render();
    }).catch(function (e) {
      if (mostrarErro !== false) VK.toast(e.message, "error");
      render();
    });

    var limpar = function () { VK.state.carregando = null; };
    VK.state.carregando = p.then(limpar, limpar);
    return VK.state.carregando;
  }

  /* ---------------- Filtros ---------------- */

  function filtrados() {
    var f = VK.state.filtros;
    var lista = VK.state.pedidos.slice();

    if (f.confeccao) {
      lista = lista.filter(function (p) { return p.codigo_confeccao === f.confeccao; });
    }
    if (f.busca) {
      var t = f.busca.toLowerCase();
      lista = lista.filter(function (p) {
        return [p.pedido, p.cod_confec, p.produto, p.confeccao, p.marca]
          .join(" ").toLowerCase().indexOf(t) >= 0;
      });
    }
    if (f.prioridade) {
      lista = lista.filter(function (p) { return String(p.prioridade) === f.prioridade; });
    }
    if (f.atrasados) {
      lista = lista.filter(function (p) {
        return p.atrasado && p.status !== "Pronto" && p.status !== "Entregue";
      });
    }
    if (f.ocultarEntregues) {
      lista = lista.filter(function (p) { return p.status !== "Entregue"; });
    }

    var PESO = { "Atrasado": 0, "Alta": 1, "Média": 2, "Baixa": 3 };
    lista.sort(function (a, b) {
      if (f.ordem === "prioridade") {
        var d = (PESO[a.prioridade] === undefined ? 9 : PESO[a.prioridade]) -
                (PESO[b.prioridade] === undefined ? 9 : PESO[b.prioridade]);
        if (d !== 0) return d;
      }
      if (f.ordem === "qtd") return (Number(b.saldo) || 0) - (Number(a.saldo) || 0);
      if (f.ordem === "pedido") return String(a.pedido).localeCompare(String(b.pedido));
      // padrão: entrega (sem data por último)
      var da = a.dt_entrega || "9999-12-31";
      var db = b.dt_entrega || "9999-12-31";
      if (da !== db) return da < db ? -1 : 1;
      return (PESO[a.prioridade] === undefined ? 9 : PESO[a.prioridade]) -
             (PESO[b.prioridade] === undefined ? 9 : PESO[b.prioridade]);
    });

    return lista;
  }

  /* ---------------- Render ---------------- */

  function kpi(rotulo, valor, obs, linha) {
    return '<div class="kpi" style="--linha:' + linha + '">' +
      '<span class="rotulo">' + rotulo + "</span>" +
      '<span class="valor">' + valor + "</span>" +
      '<span class="obs">' + obs + "</span></div>";
  }

  function renderKpis(lista) {
    var pecas = lista.reduce(function (s, p) { return s + (Number(p.saldo) || 0); }, 0);
    var atrasados = lista.filter(function (p) {
      return p.atrasado && p.status !== "Pronto" && p.status !== "Entregue";
    });
    var andamento = lista.filter(function (p) { return p.status === "Em andamento"; });
    var prontos = lista.filter(function (p) { return p.status === "Pronto" || p.status === "Entregue"; });
    var pct = lista.length ? Math.round((prontos.length / lista.length) * 100) : 0;
    var pecasProntas = andamento.reduce(function (s, p) {
      return s + (Number(p.qtd_pronta) || 0);
    }, 0);

    var html =
      kpi("Pedidos", VK.num(lista.length), VK.ehAnalista()
        ? VK.state.filtros.confeccao ? "filtro por confecção" : "todas as confecções"
        : "da sua confecção", "#6366f1") +
      kpi("Peças", VK.num(pecas), "saldo em aberto", "#38bdf8") +
      kpi("Atrasados", VK.num(atrasados.length),
        atrasados.length ? "exigem atenção" : "nenhum atraso", "#ef4444") +
      kpi("Em produção", VK.num(andamento.length),
        VK.num(andamento.reduce(function (s, p) { return s + (Number(p.saldo) || 0); }, 0)) + " un" +
        (pecasProntas ? " · " + VK.num(pecasProntas) + " prontas" : ""),
        "#f59e0b") +
      kpi("Progresso", pct + "%", prontos.length + " de " + lista.length + " concluídos", "#10b981");

    VK.$("#kpis").innerHTML = html;
  }

  function cardHtml(p) {
    var alvos = movimentos(p);
    var botoes = "";
    if (podeParcial(p)) {
      botoes += '<button type="button" data-parcial="1" class="parcial" ' +
        'title="Registrar pronto parcial" aria-label="Registrar pronto parcial">◐</button>';
    }
    botoes += alvos.map(function (alvo) {
      var seta = alvo === "Pendente" ? "←" : alvo === "Pronto" ? "✓" : alvo === "Entregue" ? "📦" : "→";
      return '<button type="button" data-mover="' + VK.esc(alvo) + '" title="' +
        VK.esc(ROTULO_MOV[alvo] || alvo) + '">' + seta + "</button>";
    }).join("");

    var prazo = VK.classePrazo(p);
    var prio = p.prioridade || "Baixa";

    return '<article class="card prio-' + VK.esc(prio) + '"' +
      ' draggable="' + (alvos.length ? "true" : "false") + '"' +
      ' data-chave="' + VK.esc(p.chave) + '">' +
      '<div class="top"><span class="num">#' + VK.esc(p.pedido || "—") + "</span>" +
      '<span class="pill ' + VK.esc(prio) + '">' + VK.esc(prio) + "</span></div>" +
      '<div class="prod">' + VK.esc(p.produto || "Sem descrição") + "</div>" +
      '<div class="meta">' +
      '<span class="chip">Cód ' + VK.esc(p.cod_confec || "—") + "</span>" +
      '<span class="chip qtd">' + VK.num(p.saldo) + " un</span>" +
      (p.qe ? '<span class="chip qe">Q.E ' + VK.num(p.qe) + "</span>" : "") +
      (p.marca ? '<span class="chip">' + VK.esc(p.marca) + "</span>" : "") +
      "</div>" +
      progressoHtml(p) +
      '<div class="foot">' +
      '<span class="due ' + prazo + '">' + VK.dataBR(p.dt_entrega) +
      (p.dias === null || p.dias === undefined ? "" : " · " + VK.diasTxt(p.dias)) + "</span>" +
      (VK.ehAnalista() ? '<span class="conf-tag" title="' + VK.esc(p.confeccao) + '">' +
        VK.esc(p.confeccao) + "</span>" : "") +
      "</div>" +
      '<div class="status-linha"><span>' +
      (p.status_por
        ? "por " + VK.esc(p.status_por) + " · " + VK.dataHora(p.status_em)
        : "sem movimentação") +
      "</span>" + (botoes ? '<span class="acoes">' + botoes + "</span>" : "") +
      "</div></article>";
  }

  function render() {
    var lista = filtrados();
    renderKpis(lista);

    var ocultar = VK.state.filtros.ocultarEntregues;
    var board = VK.$("#board");
    board.classList.toggle("oculto-entregue", ocultar);

    var colunas = COLUNAS.filter(function (c) { return !(ocultar && c.id === "Entregue"); });

    board.innerHTML = colunas.map(function (col) {
      var itens = lista.filter(function (p) { return p.status === col.id; });
      var pecas = itens.reduce(function (s, p) { return s + (Number(p.saldo) || 0); }, 0);
      var limite = VK.state.mostrar[col.id] || 50;
      var visiveis = itens.slice(0, limite);

      var corpo = itens.length
        ? visiveis.map(cardHtml).join("") +
          (itens.length > visiveis.length
            ? '<button class="carregar-mais" type="button" data-mais="' + col.id + '">Mostrar mais ' +
              Math.min(50, itens.length - visiveis.length) + " pedidos…</button>"
            : "")
        : '<div class="col-vazio">Nenhum pedido</div>';

      return '<div class="column" data-status="' + col.id + '">' +
        '<header><span class="dot" style="--dot:' + col.cor + '"></span>' +
        "<strong>" + col.rotulo + "</strong>" +
        '<span class="count">' + itens.length + "</span>" +
        '<span class="sum">' + VK.num(pecas) + " un</span></header>" +
        '<div class="col-body">' + corpo + "</div></div>";
    }).join("");

    var total = VK.state.pedidos.length;
    var dica = lista.length + " de " + total + " pedido(s) exibido(s)";
    if (VK.state.filtros.atrasados) dica += " · somente atrasados";
    if (VK.state.filtros.busca) dica += ' · busca: "' + VK.state.filtros.busca + '"';
    if (VK.state.tab === "kanban" && total === 0) {
      dica = "Nenhum pedido recebido ainda. No Visualfil, gere o Kanban e clique em “Enviar Kanban”.";
    }
    VK.$("#board-hint").textContent = dica;
  }

  /* ---------------- Movimentação ---------------- */

  function mover(chave, novo) {
    if (!chave || !novo) return;

    var pedido = null;
    VK.state.pedidos.forEach(function (p) { if (p.chave === chave) pedido = p; });
    if (!pedido || pedido.status === novo) return;

    if (movimentos(pedido).indexOf(novo) < 0) {
      VK.toast("Transição não permitida para o seu perfil: " + pedido.status + " → " + novo + ".", "warn");
      return;
    }

    var antes = Object.assign({}, pedido);
    var sessao = VK.session() || {};

    pedido.status = novo;
    pedido.status_por = sessao.user || "";
    pedido.status_em = new Date().toISOString();
    pedido.qtd_pronta = (novo === "Pronto" || novo === "Entregue")
      ? (Number(pedido.saldo) || 0)
      : 0;
    pedido.pronto_parcial_em = "";
    pedido.pronto_parcial_por = "";
    render();

    VK.call("atualizarstatus", { chave: chave, status: novo })
      .then(function () {
        VK.toast("Pedido #" + (pedido.pedido || "") + " → " + novo + ".", "ok", 2400);
        VK.atualizarBadges();
        return carregar(false, true);
      })
      .catch(function (e) {
        Object.assign(pedido, antes);
        render();
        VK.toast(e.message, "error");
      });
  }

  /* ---------------- Detalhe ---------------- */

  var EXTRAS = ["Compra", "Dt Emissão", "Tecido", "Consumo", "NF de Remessa", "Dt Remessa", "Ope. produtiva"];

  function abrirDetalhe(chave) {
    var p = null;
    VK.state.pedidos.forEach(function (x) { if (x.chave === chave) p = x; });
    if (!p) { VK.toast("Pedido não encontrado. Atualize o quadro.", "warn"); return; }

    VK.$("#pedido-titulo").textContent = "Pedido #" + (p.pedido || "—");

    var extras = p.extras || {};
    var linhasExtras = EXTRAS.map(function (k) {
      var v = extras[k];
      if (v === undefined || v === null || v === "") return "";

      // Datas vêm em ISO da planilha e números podem ter casas decimais.
      var texto = String(v);
      if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
        texto = VK.dataBR(texto);
      } else if (typeof v === "number" && !Number.isInteger(v)) {
        texto = v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
      }

      return '<div class="item"><span>' + VK.esc(k) + "</span><strong>" + VK.esc(texto) + "</strong></div>";
    }).join("");

    var saldo = Math.max(0, Number(p.saldo) || 0);
    var pronta = Math.min(Math.max(0, Number(p.qtd_pronta) || 0), saldo);
    var parcialLinha = pronta > 0
      ? '<div class="item"><span>Prontas</span><strong>' +
        VK.num(pronta) + " / " + VK.num(saldo) + " un</strong></div>"
      : "";

    var etapas = ["Pendente", "Em andamento", "Pronto", "Entregue"];
    var indice = etapas.indexOf(p.status);

    var timeline = '<div class="timeline">' + etapas.map(function (etapa, i) {
      var cls = i < indice ? "feito" : i === indice ? "atual" : "";
      var quando = i === indice && p.status_em
        ? "<small>" + VK.esc(p.status_por || "") + " · " + VK.dataHora(p.status_em) + "</small>"
        : "";
      return '<div class="passo ' + cls + '"><div class="trilho"><span class="bola"></span>' +
        (i < etapas.length - 1 ? '<span class="linha"></span>' : "") + "</div>" +
        '<div class="texto">' + etapa + quando + "</div></div>";
    }).join("") + "</div>";

    VK.$("#pedido-corpo").innerHTML =
      '<div class="detalhe">' +
      '<div class="item"><span>Produto</span><strong>' + VK.esc(p.produto || "—") + "</strong></div>" +
      '<div class="item"><span>Código confec</span><strong>' + VK.esc(p.cod_confec || "—") + "</strong></div>" +
      '<div class="item"><span>Quantidade</span><strong>' + VK.num(p.qtd) + " un</strong></div>" +
      '<div class="item"><span>Saldo</span><strong>' + VK.num(p.saldo) + " un</strong></div>" +
      parcialLinha +
      '<div class="item"><span>Entrega</span><strong>' + VK.dataBR(p.dt_entrega) +
        (p.dias === null ? "" : " · " + VK.diasTxt(p.dias)) + "</strong></div>" +
      '<div class="item"><span>Prioridade</span><strong>' + VK.esc(p.prioridade) + "</strong></div>" +
      '<div class="item"><span>Q.E</span><strong>' + VK.num(p.qe) + "</strong></div>" +
      '<div class="item"><span>Marca</span><strong>' + VK.esc(p.marca || "—") + "</strong></div>" +
      '<div class="item"><span>Confecção</span><strong>' + VK.esc(p.confeccao || "—") + "</strong></div>" +
      '<div class="item"><span>Código de vínculo</span><strong class="mono">' +
        VK.esc(p.codigo_confeccao || "—") + "</strong></div>" +
      linhasExtras +
      "</div>" +
      progressoHtml(p) +
      "<h4 style=\"margin-bottom:10px;font-size:13px\">Fluxo</h4>" + timeline;

    var acoes = "";
    if (podeParcial(p)) {
      acoes += '<button class="btn primary" type="button" data-parcial="1">◐ Pronto parcial</button>';
    }
    acoes += movimentos(p).map(function (alvo) {
      var classe = (alvo === "Pronto" && !podeParcial(p)) ? "btn primary" : "btn";
      return '<button class="' + classe + '" type="button" data-ir="' + VK.esc(alvo) + '">' +
        VK.esc(ROTULO_MOV[alvo] || alvo) + "</button>";
    }).join("");

    if (VK.ehAnalista() && p.codigo_confeccao) {
      acoes += '<button class="btn ghost" type="button" data-chat="1">💬 Abrir chat</button>';
    }

    VK.$("#pedido-acoes").innerHTML =
      '<button class="btn ghost" type="button" data-fechar="1">Fechar</button>' + acoes;

    VK.$$("#pedido-acoes [data-ir]").forEach(function (b) {
      b.addEventListener("click", function () {
        var alvo = b.getAttribute("data-ir");
        VK.fecharDialogo("dlg-pedido");
        mover(chave, alvo);
      });
    });
    VK.$$("#pedido-acoes [data-parcial]").forEach(function (b) {
      b.addEventListener("click", function () { abrirParcial(chave); });
    });
    VK.$$("#pedido-acoes [data-chat]").forEach(function (b) {
      b.addEventListener("click", function () {
        VK.state.thread = p.codigo_confeccao;
        VK.fecharDialogo("dlg-pedido");
        VK.nav("chat");
      });
    });
    VK.$$("#pedido-acoes [data-fechar]").forEach(function (b) {
      b.addEventListener("click", function () { VK.fecharDialogo("dlg-pedido"); });
    });

    VK.abrirDialogo("dlg-pedido");
  }

  /* ---------------- Pronto parcial ---------------- */

  function abrirParcial(chave) {
    var p = null;
    VK.state.pedidos.forEach(function (x) { if (x.chave === chave) p = x; });
    if (!p) { VK.toast("Pedido não encontrado. Atualize o quadro.", "warn"); return; }
    if (!podeParcial(p)) {
      VK.toast("Este pedido não está em produção no momento.", "warn");
      return;
    }

    parcialChave = chave;
    var saldo = Math.max(0, Number(p.saldo) || 0);
    var pronta = Math.min(Math.max(0, Number(p.qtd_pronta) || 0), saldo);
    var pct = saldo ? Math.round((pronta / saldo) * 100) : 0;

    VK.$("#parcial-titulo").textContent = "Pronto parcial · Pedido #" + (p.pedido || "—");
    VK.$("#parcial-resumo").innerHTML =
      "<span>Saldo em aberto: <strong>" + VK.num(saldo) + " un</strong></span>" +
      "<span>Já prontas: <strong>" + VK.num(pronta) + " un</strong> (" + pct + "%)</span>" +
      (p.status === "Pendente"
        ? "<span>Ao salvar, o pedido entra em produção.</span>"
        : "");

    var input = VK.$("#parcial-qtd");
    input.max = String(saldo);
    input.value = String(pronta);
    VK.$("#parcial-msg").textContent = "";
    VK.$("#parcial-hint").textContent =
      "Informe o total já pronto. O restante continua em produção.";

    VK.fecharDialogo("dlg-pedido");
    VK.abrirDialogo("dlg-parcial");
    setTimeout(function () {
      try { input.focus(); input.select(); } catch (e) { /* ignorado */ }
    }, 60);
  }

  /* ---------------- Exportação ---------------- */

  function exportar() {
    var lista = filtrados();
    if (!lista.length) { VK.toast("Nada para exportar com os filtros atuais.", "warn"); return; }

    VK.baixarCSV("kanban_" + new Date().toISOString().slice(0, 10) + ".csv", lista, [
      { titulo: "Pedido", valor: "pedido" },
      { titulo: "Cód Confec", valor: "cod_confec" },
      { titulo: "Produto", valor: "produto" },
      { titulo: "Qtd", valor: "qtd" },
      { titulo: "Saldo", valor: "saldo" },
      { titulo: "Prontas", valor: "qtd_pronta" },
      { titulo: "Dt Entrega", valor: function (p) { return VK.dataBR(p.dt_entrega); } },
      { titulo: "Prioridade", valor: "prioridade" },
      { titulo: "Q.E", valor: "qe" },
      { titulo: "Confecção", valor: "confeccao" },
      { titulo: "Status", valor: "status" },
      { titulo: "Atualizado por", valor: "status_por" },
    ]);
    VK.toast(lista.length + " pedido(s) exportado(s).", "ok");
  }

  /* ---------------- API pública ---------------- */

  VK.kanban = {
    abrir: function () {
      carregar(true);
    },
    carregar: carregar,
    render: render,

    silencioso: function () {
      if (VK.state.arrastando) return;
      if (document.querySelector("dialog[open]")) return;
      if (VK.state.tab !== "kanban") return;
      carregar(false);
    },

    abrirPedido: function (chave) {
      var existe = VK.state.pedidos.some(function (p) { return p.chave === chave; });
      if (existe) { abrirDetalhe(chave); return; }
      carregar(true).then(function () { abrirDetalhe(chave); });
    },

    mover: mover,
  };

  /* ---------------- Eventos ---------------- */

  var board = VK.$("#board");

  board.addEventListener("dragstart", function (ev) {
    var card = ev.target.closest(".card");
    if (!card || card.getAttribute("draggable") !== "true") { ev.preventDefault(); return; }
    VK.state.arrastando = true;
    VK.state.arrastandoChave = card.getAttribute("data-chave");
    card.classList.add("arrastando");
    try {
      ev.dataTransfer.setData("text/plain", VK.state.arrastandoChave);
      ev.dataTransfer.effectAllowed = "move";
    } catch (e) { /* alguns navegadores bloqueiam */ }
  });

  board.addEventListener("dragend", function () {
    VK.state.arrastando = false;
    VK.state.arrastandoChave = "";
    VK.$$(".card.arrastando").forEach(function (c) { c.classList.remove("arrastando"); });
    VK.$$(".column.dragover").forEach(function (c) { c.classList.remove("dragover"); });
  });

  board.addEventListener("dragover", function (ev) {
    var col = ev.target.closest(".column");
    if (!col) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    VK.$$(".column.dragover").forEach(function (c) {
      if (c !== col) c.classList.remove("dragover");
    });
    col.classList.add("dragover");
  });

  board.addEventListener("drop", function (ev) {
    var col = ev.target.closest(".column");
    if (!col) return;
    ev.preventDefault();
    var chave = VK.state.arrastandoChave;
    VK.$$(".column.dragover").forEach(function (c) { c.classList.remove("dragover"); });
    setTimeout(function () { VK.state.arrastando = false; }, 250);
    if (chave) mover(chave, col.getAttribute("data-status"));
  });

  VK.on(board, "click", "[data-mover]", function (ev, el) {
    ev.stopPropagation();
    var card = el.closest(".card");
    if (card) mover(card.getAttribute("data-chave"), el.getAttribute("data-mover"));
  });

  VK.on(board, "click", "[data-parcial]", function (ev, el) {
    ev.stopPropagation();
    var card = el.closest(".card");
    if (card) abrirParcial(card.getAttribute("data-chave"));
  });

  VK.on(board, "click", "[data-mais]", function (ev, el) {
    var status = el.getAttribute("data-mais");
    VK.state.mostrar[status] = (VK.state.mostrar[status] || 50) + 50;
    render();
  });

  VK.on(board, "click", ".card", function (ev, card) {
    if (ev.target.closest("[data-mover]") || ev.target.closest("[data-parcial]")) return;
    abrirDetalhe(card.getAttribute("data-chave"));
  });

  // Filtros
  VK.$("#f-busca").addEventListener("input", function (ev) {
    VK.state.filtros.busca = ev.target.value.trim();
    VK.state.mostrar = {};
    render();
  });

  VK.$("#f-prioridade").addEventListener("change", function (ev) {
    VK.state.filtros.prioridade = ev.target.value;
    VK.state.mostrar = {};
    render();
  });

  VK.$("#f-ordem").addEventListener("change", function (ev) {
    VK.state.filtros.ordem = ev.target.value;
    render();
  });

  VK.$("#f-conf").addEventListener("change", function (ev) {
    VK.state.filtros.confeccao = ev.target.value;
    VK.state.mostrar = {};
    carregar(true, true);
  });

  VK.$("#f-atrasados").addEventListener("change", function (ev) {
    VK.state.filtros.atrasados = ev.target.checked;
    VK.$("#lbl-atrasados").classList.toggle("on", ev.target.checked);
    VK.state.mostrar = {};
    render();
  });

  VK.$("#f-ocultar").addEventListener("change", function (ev) {
    VK.state.filtros.ocultarEntregues = ev.target.checked;
    VK.$("#lbl-ocultar").classList.toggle("on", ev.target.checked);
    render();
  });

  VK.$("#btn-atualizar").addEventListener("click", function () {
    VK.state.resumo = [];
    carregar(true, true).then(function () { VK.toast("Quadro atualizado.", "info", 1600); });
  });

  VK.$("#btn-exportar").addEventListener("click", exportar);

  // Pronto parcial
  VK.$("#parcial-tudo").addEventListener("click", function () {
    var p = null;
    VK.state.pedidos.forEach(function (x) { if (x.chave === parcialChave) p = x; });
    if (!p) return;
    var input = VK.$("#parcial-qtd");
    input.value = String(Math.max(0, Number(p.saldo) || 0));
    input.focus();
  });

  VK.$("#form-parcial").addEventListener("submit", function (ev) {
    ev.preventDefault();

    var p = null;
    VK.state.pedidos.forEach(function (x) { if (x.chave === parcialChave) p = x; });
    if (!p) { VK.toast("Pedido não encontrado. Atualize o quadro.", "warn"); return; }

    var saldo = Math.max(0, Number(p.saldo) || 0);
    var input = VK.$("#parcial-qtd");
    var msg = VK.$("#parcial-msg");
    var bruto = String(input.value || "").trim();

    if (!/^\d+$/.test(bruto)) {
      msg.textContent = "Informe uma quantidade inteira de peças.";
      input.focus();
      return;
    }
    var total = parseInt(bruto, 10);
    if (total > saldo) {
      msg.textContent = "O máximo é o saldo em aberto (" + VK.num(saldo) + " un).";
      input.focus();
      return;
    }

    var btn = this.querySelector('button[type="submit"]');
    msg.textContent = "";
    btn.disabled = true;
    btn.textContent = "Salvando…";

    VK.call("registrarprontoparcial", { chave: parcialChave, qtd_pronta: total })
      .then(function (r) {
        VK.fecharDialogo("dlg-parcial");
        if (r && r.completo) {
          VK.toast("Pedido #" + (p.pedido || "") + " marcado como pronto (" +
            VK.num(saldo) + " un).", "ok");
        } else {
          VK.toast("Pronto parcial: " + VK.num(total) + " de " +
            VK.num(saldo) + " un.", "ok");
        }
        VK.atualizarBadges();
        return carregar(false, true);
      })
      .catch(function (e) {
        msg.textContent = e.message || "Não foi possível salvar.";
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "Salvar pronto parcial";
      });
  });

  // Teclado: "/" foca a busca
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "/" && VK.state.tab === "kanban" &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      ev.preventDefault();
      VK.$("#f-busca").focus();
    }
  });
})();
