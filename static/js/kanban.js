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
      // Confecção não confirma entrega nem reabre pedido já entregue.
      if (p.status === "Entregue") return [];
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
    var quebra = Math.min(Math.max(0, Number(p.qtd_quebra) || 0), saldo);
    var pronta = Math.min(Math.max(0, Number(p.qtd_pronta) || 0), Math.max(0, saldo - quebra));
    if ((!pronta && !quebra) || p.status === "Pronto" || p.status === "Entregue") return "";
    var contabilizada = Math.min(saldo, pronta + quebra);
    var pct = saldo ? Math.round((contabilizada / saldo) * 100) : 0;
    var titulo = VK.num(pronta) + " prontas" +
      (quebra ? " + " + VK.num(quebra) + " quebra" : "") + " de " + VK.num(saldo);
    return '<div class="progresso-parcial" title="' + VK.esc(titulo) + '">' +
      '<div class="barra"><span style="width:' + pct + '%"></span></div>' +
      '<small>◐ ' + VK.num(pronta) + " de " + VK.num(saldo) + " prontas" +
      (quebra ? " · " + VK.num(quebra) + " quebra" : "") + "</small></div>";
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

  function filtrados(incluirEntregues) {
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
    if (f.somenteQe) {
      lista = lista.filter(function (p) { return (Number(p.qe) || 0) > 0; });
    }
    if (f.ocultarEntregues && !incluirEntregues) {
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

  function renderKpis(lista, listaTotal) {
    var pecas = lista.reduce(function (s, p) { return s + (Number(p.saldo) || 0); }, 0);
    var quebraTotal = (listaTotal || lista).reduce(function (s, p) {
      return s + (Number(p.qtd_quebra) || 0);
    }, 0);
    var atrasados = lista.filter(function (p) {
      return p.atrasado && p.status !== "Pronto" && p.status !== "Entregue";
    });
    var andamento = lista.filter(function (p) { return p.status === "Em andamento"; });
    var prontos = lista.filter(function (p) { return p.status === "Pronto" || p.status === "Entregue"; });
    var pct = lista.length ? Math.round((prontos.length / lista.length) * 100) : 0;
    var pecasProntas = andamento.reduce(function (s, p) {
      return s + (Number(p.qtd_pronta) || 0);
    }, 0);
    var pecasQuebra = andamento.reduce(function (s, p) {
      return s + (Number(p.qtd_quebra) || 0);
    }, 0);

    var html =
      kpi("Pedidos", VK.num(lista.length), VK.ehAnalista()
        ? VK.state.filtros.confeccao ? "filtro por confecção" : "todas as confecções"
        : "da sua confecção", "#6366f1") +
      kpi("Peças", VK.num(pecas), "saldo em aberto" +
        (quebraTotal ? " · " + VK.num(quebraTotal) + " un em quebra" : ""), "#38bdf8") +
      kpi("Atrasados", VK.num(atrasados.length),
        atrasados.length ? "exigem atenção" : "nenhum atraso", "#ef4444") +
      kpi("Em produção", VK.num(andamento.length),
        VK.num(andamento.reduce(function (s, p) { return s + (Number(p.saldo) || 0); }, 0)) + " un" +
        (pecasProntas ? " · " + VK.num(pecasProntas) + " prontas" : "") +
        (pecasQuebra ? " · " + VK.num(pecasQuebra) + " quebra" : ""),
        "#f59e0b") +
      kpi("Progresso", pct + "%", prontos.length + " de " + lista.length + " concluídos", "#10b981");

    VK.$("#kpis").innerHTML = html;
  }

  function cardHtml(p) {
    var alvos = movimentos(p);
    var saldo = Math.max(0, Number(p.saldo) || 0);
    var quebra = Math.min(Math.max(0, Number(p.qtd_quebra) || 0), saldo);
    var botoes = "";
    if (podeParcial(p)) {
      botoes += '<button type="button" data-parcial="1" class="parcial" ' +
        'title="Registrar produção / quebra de tecido" ' +
        'aria-label="Registrar produção / quebra de tecido">◐</button>';
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
      (quebra ? '<span class="chip quebra" title="Peças que não virão por falta de tecido">✂ ' +
        VK.num(quebra) + " quebra</span>" : "") +
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
    renderKpis(lista, filtrados(true));

    var ocultar = VK.state.filtros.ocultarEntregues;
    var board = VK.$("#board");
    board.classList.toggle("oculto-entregue", ocultar);

    var colunas = COLUNAS.filter(function (c) { return !(ocultar && c.id === "Entregue"); });

    board.innerHTML = colunas.map(function (col) {
      var itens = lista.filter(function (p) { return p.status === col.id; });
      var pecas = itens.reduce(function (s, p) { return s + (Number(p.saldo) || 0); }, 0);
      var quebraCol = itens.reduce(function (s, p) { return s + (Number(p.qtd_quebra) || 0); }, 0);
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
        '<span class="sum">' + VK.num(pecas) + " un" +
        (quebraCol ? " · " + VK.num(quebraCol) + " quebra" : "") + "</span></header>" +
        '<div class="col-body">' + corpo + "</div></div>";
    }).join("");

    var total = VK.state.pedidos.length;
    var dica = lista.length + " de " + total + " pedido(s) exibido(s)";
    if (VK.state.filtros.atrasados) dica += " · somente atrasados";
    if (VK.state.filtros.somenteQe) dica += " · somente com Q.E";
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
    var saldo = Math.max(0, Number(pedido.saldo) || 0);
    var quebra = Math.min(Math.max(0, Number(pedido.qtd_quebra) || 0), saldo);

    pedido.status = novo;
    pedido.status_por = sessao.user || "";
    pedido.status_em = new Date().toISOString();
    pedido.qtd_pronta = (novo === "Pronto" || novo === "Entregue")
      ? Math.max(0, saldo - quebra)
      : 0;
    if (novo === "Pendente") pedido.qtd_quebra = 0;
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
    var quebra = Math.min(Math.max(0, Number(p.qtd_quebra) || 0), saldo);
    var pronta = Math.min(Math.max(0, Number(p.qtd_pronta) || 0), Math.max(0, saldo - quebra));
    var parcialLinha = (pronta > 0 || quebra > 0)
      ? '<div class="item"><span>Prontas</span><strong>' +
        VK.num(pronta) + " / " + VK.num(saldo) + " un</strong></div>" +
        (quebra > 0
          ? '<div class="item"><span>Quebra de tecido</span><strong>' +
            VK.num(quebra) + " un</strong></div>"
          : "")
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
      acoes += '<button class="btn primary" type="button" data-parcial="1">◐ Produção / quebra</button>';
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

  /* ---------------- Produção / pronto parcial ---------------- */

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
    var quebra = Math.min(Math.max(0, Number(p.qtd_quebra) || 0), saldo);
    var pronta = Math.min(Math.max(0, Number(p.qtd_pronta) || 0), Math.max(0, saldo - quebra));
    var contabilizada = Math.min(saldo, pronta + quebra);
    var pct = saldo ? Math.round((contabilizada / saldo) * 100) : 0;

    VK.$("#parcial-titulo").textContent = "Produção · Pedido #" + (p.pedido || "—");
    VK.$("#parcial-resumo").innerHTML =
      "<span>Saldo em aberto: <strong>" + VK.num(saldo) + " un</strong></span>" +
      "<span>Já prontas: <strong>" + VK.num(pronta) + " un</strong></span>" +
      "<span>Quebra: <strong>" + VK.num(quebra) + " un</strong></span>" +
      "<span>Contabilizado: <strong>" + VK.num(contabilizada) + " un (" + pct + "%)</strong></span>" +
      (p.status === "Pendente"
        ? "<span>Ao salvar, o pedido entra em produção.</span>"
        : "");

    var input = VK.$("#parcial-qtd");
    var inputQuebra = VK.$("#parcial-quebra");
    input.max = String(saldo);
    input.value = String(pronta);
    inputQuebra.max = String(saldo);
    inputQuebra.value = String(quebra);
    VK.$("#parcial-msg").textContent = "";
    VK.$("#parcial-hint").textContent =
      "Informe os totais acumulados. Peças prontas + quebra não podem passar do saldo.";

    VK.fecharDialogo("dlg-pedido");
    VK.abrirDialogo("dlg-parcial");
    setTimeout(function () {
      try { input.focus(); input.select(); } catch (e) { /* ignorado */ }
    }, 60);
  }

  /* ---------------- Exportação ---------------- */

  var CORES_XLSX = {
    marca: "4F46E5",
    marcaEscura: "312E81",
    marcaClara: "EEF2FF",
    texto: "0F172A",
    suave: "64748B",
    fundo: "F8FAFC",
    branco: "FFFFFF",
    borda: "E2E8F0",
    azul: "E0F2FE",
    azulTexto: "0369A1",
    ambar: "FEF3C7",
    ambarTexto: "92400E",
    verde: "DCFCE7",
    verdeTexto: "047857",
    vermelho: "FEE2E2",
    vermelhoTexto: "B91C1C",
    cinza: "E2E8F0",
    cinzaTexto: "475569",
  };

  var CORES_STATUS = {
    "Pendente": { fundo: CORES_XLSX.azul, texto: CORES_XLSX.azulTexto },
    "Em andamento": { fundo: CORES_XLSX.ambar, texto: CORES_XLSX.ambarTexto },
    "Pronto": { fundo: CORES_XLSX.verde, texto: CORES_XLSX.verdeTexto },
    "Entregue": { fundo: CORES_XLSX.cinza, texto: CORES_XLSX.cinzaTexto },
  };

  var CORES_PRIORIDADE_XLSX = {
    "Atrasado": { fundo: "FEE2E2", texto: "B91C1C" },
    "Alta": { fundo: "FFEDD5", texto: "9A3412" },
    "Média": { fundo: "FEF3C7", texto: "92400E" },
    "Baixa": { fundo: "DCFCE7", texto: "047857" },
  };

  function corArgb(hex) {
    return "FF" + String(hex || "000000").replace("#", "").toUpperCase();
  }

  function pintarCelula(cell, fundo) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: corArgb(fundo) } };
  }

  function bordaCelula(cell, cor) {
    var corBorda = corArgb(cor || CORES_XLSX.borda);
    var lado = { style: "thin", color: { argb: corBorda } };
    cell.border = { top: lado, left: lado, bottom: lado, right: lado };
  }

  function fonteCelula(cell, tamanho, negrito, cor) {
    cell.font = {
      name: "Segoe UI",
      size: tamanho || 11,
      bold: !!negrito,
      color: { argb: corArgb(cor || CORES_XLSX.texto) },
    };
  }

  function alinhamentoCelula(cell, horizontal, vertical, wrap) {
    cell.alignment = {
      horizontal: horizontal || "left",
      vertical: vertical || "middle",
      wrapText: !!wrap,
    };
  }

  function estiloCabecalhoXlsx(cell) {
    pintarCelula(cell, CORES_XLSX.marcaEscura);
    fonteCelula(cell, 10, true, CORES_XLSX.branco);
    alinhamentoCelula(cell, "center", "middle", true);
    bordaCelula(cell, CORES_XLSX.marcaEscura);
  }

  function dataXlsx(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso ? String(iso) : "—";
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function progressoPedido(p) {
    var saldo = Math.max(0, Number(p.saldo) || 0);
    if (p.status === "Pronto" || p.status === "Entregue") return saldo ? 1 : 0;
    var pronta = Math.max(0, Number(p.qtd_pronta) || 0);
    var quebra = Math.max(0, Number(p.qtd_quebra) || 0);
    return saldo ? Math.min(1, (pronta + quebra) / saldo) : 0;
  }

  function filtrosResumo() {
    var f = VK.state.filtros;
    var partes = [];
    if (f.confeccao) {
      var nome = f.confeccao;
      (VK.state.resumo || []).some(function (c) {
        if (c.codigo === f.confeccao) { nome = c.nome; return true; }
        return false;
      });
      partes.push("Confecção: " + nome);
    } else {
      partes.push("Todas as confecções");
    }
    if (f.prioridade) partes.push("Prioridade: " + f.prioridade);
    if (f.busca) partes.push('Busca: "' + f.busca + '"');
    if (f.atrasados) partes.push("Somente atrasados");
    if (f.somenteQe) partes.push("Somente com Q.E");
    if (!f.ocultarEntregues) partes.push("Inclui entregues");
    return partes.join("  ·  ");
  }

  function metricasLista(lista) {
    var pecas = 0, quebra = 0, qe = 0, prontas = 0;
    var atrasados = 0, andamento = 0, concluidos = 0;
    lista.forEach(function (p) {
      pecas += Number(p.saldo) || 0;
      quebra += Number(p.qtd_quebra) || 0;
      qe += Number(p.qe) || 0;
      prontas += Number(p.qtd_pronta) || 0;
      if (p.status === "Em andamento") andamento += 1;
      if (p.status === "Pronto" || p.status === "Entregue") concluidos += 1;
      if (p.atrasado && p.status !== "Pronto" && p.status !== "Entregue") atrasados += 1;
    });
    return {
      pedidos: lista.length,
      pecas: pecas,
      prontas: prontas,
      quebra: quebra,
      qe: qe,
      atrasados: atrasados,
      andamento: andamento,
      concluidos: concluidos,
      progresso: lista.length ? concluidos / lista.length : 0,
    };
  }

  function resumoPorStatus(lista) {
    return COLUNAS.map(function (col) {
      var itens = lista.filter(function (p) { return p.status === col.id; });
      return {
        rotulo: col.rotulo,
        pedidos: itens.length,
        pecas: itens.reduce(function (s, p) { return s + (Number(p.saldo) || 0); }, 0),
        quebra: itens.reduce(function (s, p) { return s + (Number(p.qtd_quebra) || 0); }, 0),
        qe: itens.reduce(function (s, p) { return s + (Number(p.qe) || 0); }, 0),
        cor: col.id,
      };
    });
  }

  function resumoPorConfeccao(lista) {
    var mapa = {};
    lista.forEach(function (p) {
      var nome = p.confeccao || "Sem Confecção";
      if (!mapa[nome]) {
        mapa[nome] = { nome: nome, pedidos: 0, pecas: 0, quebra: 0, qe: 0 };
      }
      mapa[nome].pedidos += 1;
      mapa[nome].pecas += Number(p.saldo) || 0;
      mapa[nome].quebra += Number(p.qtd_quebra) || 0;
      mapa[nome].qe += Number(p.qe) || 0;
    });
    return Object.keys(mapa).map(function (nome) { return mapa[nome]; }).sort(function (a, b) {
      if (b.pecas !== a.pecas) return b.pecas - a.pecas;
      return a.nome.localeCompare(b.nome);
    });
  }

  function resumoPorPrioridade(lista) {
    var ordem = ["Atrasado", "Alta", "Média", "Baixa"];
    return ordem.map(function (prio) {
      var itens = lista.filter(function (p) { return String(p.prioridade) === prio; });
      return {
        rotulo: prio,
        pedidos: itens.length,
        pecas: itens.reduce(function (s, p) { return s + (Number(p.saldo) || 0); }, 0),
        quebra: itens.reduce(function (s, p) { return s + (Number(p.qtd_quebra) || 0); }, 0),
        qe: itens.reduce(function (s, p) { return s + (Number(p.qe) || 0); }, 0),
      };
    }).filter(function (linha) { return linha.pedidos > 0; });
  }

  function tituloSecaoXlsx(ws, linha, titulo) {
    var cell = ws.getCell(linha, 1);
    cell.value = titulo;
    fonteCelula(cell, 12, true, CORES_XLSX.marcaEscura);
    alinhamentoCelula(cell, "left", "middle");
    ws.getRow(linha).height = 24;
  }

  function tabelaXlsx(ws, linha, titulo, cabecalhos, linhas, estilizarLinha) {
    tituloSecaoXlsx(ws, linha, titulo);
    var linhaCab = linha + 1;
    cabecalhos.forEach(function (tituloCol, indice) {
      var cell = ws.getCell(linhaCab, indice + 1);
      cell.value = tituloCol;
      estiloCabecalhoXlsx(cell);
    });
    ws.getRow(linhaCab).height = 25;

    linhas.forEach(function (valores, indiceLinha) {
      var numeroLinha = linhaCab + 1 + indiceLinha;
      valores.forEach(function (valor, indiceColuna) {
        var cell = ws.getCell(numeroLinha, indiceColuna + 1);
        cell.value = valor;
        fonteCelula(cell, 10, false, CORES_XLSX.texto);
        alinhamentoCelula(cell, indiceColuna === 0 ? "left" : "right", "middle", true);
        pintarCelula(cell, indiceLinha % 2 ? CORES_XLSX.fundo : CORES_XLSX.branco);
        bordaCelula(cell);
      });
      if (estilizarLinha) estilizarLinha(ws, numeroLinha, valores, indiceLinha);
      ws.getRow(numeroLinha).height = 21;
    });
    return linhaCab + linhas.length + 2;
  }

  function criarAbaResumo(wb, lista) {
    var ws = wb.addWorksheet("Resumo", {
      views: [{ showGridLines: false }],
      properties: { defaultRowHeight: 20 },
    });
    ws.columns = [
      { width: 24 }, { width: 16 }, { width: 16 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 },
    ];

    ws.mergeCells("A1:H1");
    var titulo = ws.getCell("A1");
    titulo.value = "VISUAL KANBAN";
    pintarCelula(titulo, CORES_XLSX.marcaEscura);
    fonteCelula(titulo, 22, true, CORES_XLSX.branco);
    alinhamentoCelula(titulo, "left", "middle");
    titulo.alignment.indent = 1;
    ws.getRow(1).height = 44;

    ws.mergeCells("A2:H2");
    var subtitulo = ws.getCell("A2");
    subtitulo.value = "Relatório de produção · gerado em " + VK.dataHora(new Date().toISOString());
    pintarCelula(subtitulo, CORES_XLSX.marca);
    fonteCelula(subtitulo, 11, false, CORES_XLSX.branco);
    alinhamentoCelula(subtitulo, "left", "middle");
    subtitulo.alignment.indent = 1;
    ws.getRow(2).height = 24;
    ws.getRow(3).height = 8;

    var m = metricasLista(lista);
    var kpis = [
      { rotulo: "PEDIDOS", valor: VK.num(m.pedidos), cor: "6366F1" },
      { rotulo: "PEÇAS EM ABERTO", valor: VK.num(m.pecas), cor: "0EA5E9" },
      { rotulo: "Q.E", valor: VK.num(m.qe), cor: "F59E0B" },
      { rotulo: "QUEBRA", valor: VK.num(m.quebra), cor: "EF4444" },
      { rotulo: "ATRASADOS", valor: VK.num(m.atrasados), cor: "EF4444" },
      { rotulo: "EM PRODUÇÃO", valor: VK.num(m.andamento), cor: "F59E0B" },
      { rotulo: "CONCLUÍDOS", valor: VK.num(m.concluidos), cor: "10B981" },
      { rotulo: "PROGRESSO", valor: Math.round(m.progresso * 100) + "%", cor: "10B981" },
    ];

    kpis.forEach(function (item, indice) {
      var coluna = indice + 1;
      var rotulo = ws.getCell(4, coluna);
      rotulo.value = item.rotulo;
      pintarCelula(rotulo, CORES_XLSX.marcaClara);
      fonteCelula(rotulo, 9, true, CORES_XLSX.marcaEscura);
      alinhamentoCelula(rotulo, "center", "middle", true);
      bordaCelula(rotulo, "C7D2FE");

      var valor = ws.getCell(5, coluna);
      valor.value = item.valor;
      pintarCelula(valor, CORES_XLSX.branco);
      fonteCelula(valor, 18, true, item.cor);
      alinhamentoCelula(valor, "center", "middle", true);
      bordaCelula(valor, "C7D2FE");
    });
    ws.getRow(4).height = 26;
    ws.getRow(5).height = 38;

    var filtrosTitulo = ws.getCell(7, 1);
    filtrosTitulo.value = "Filtros aplicados";
    fonteCelula(filtrosTitulo, 11, true, CORES_XLSX.marcaEscura);

    ws.mergeCells("A8:H8");
    var filtros = ws.getCell("A8");
    filtros.value = filtrosResumo();
    pintarCelula(filtros, CORES_XLSX.fundo);
    fonteCelula(filtros, 10, false, CORES_XLSX.suave);
    alinhamentoCelula(filtros, "left", "middle", true);
    filtros.alignment.indent = 1;
    bordaCelula(filtros);
    ws.getRow(8).height = 30;

    var proximaLinha = 10;
    var statusLinhas = resumoPorStatus(lista).map(function (s) {
      return [s.rotulo, s.pedidos, s.pecas, s.quebra, s.qe];
    });
    proximaLinha = tabelaXlsx(
      ws,
      proximaLinha,
      "Distribuição por status",
      ["Status", "Pedidos", "Peças", "Quebra", "Q.E"],
      statusLinhas,
      function (sheet, linha, valores) {
        var cell = sheet.getCell(linha, 1);
        var mapa = { "A produzir": "Pendente", "Em produção": "Em andamento" };
        var chave = mapa[String(valores[0])] || String(valores[0]);
        var cor = CORES_STATUS[chave] || { fundo: CORES_XLSX.marcaClara, texto: CORES_XLSX.marcaEscura };
        pintarCelula(cell, cor.fundo);
        fonteCelula(cell, 10, true, cor.texto);
      }
    );

    var confLinhas = resumoPorConfeccao(lista).map(function (c) {
      return [c.nome, c.pedidos, c.pecas, c.quebra, c.qe];
    });
    proximaLinha = tabelaXlsx(
      ws,
      proximaLinha,
      "Por confecção",
      ["Confecção", "Pedidos", "Peças", "Quebra", "Q.E"],
      confLinhas
    );

    var prioLinhas = resumoPorPrioridade(lista).map(function (p) {
      return [p.rotulo, p.pedidos, p.pecas, p.quebra, p.qe];
    });
    proximaLinha = tabelaXlsx(
      ws,
      proximaLinha,
      "Por prioridade",
      ["Prioridade", "Pedidos", "Peças", "Quebra", "Q.E"],
      prioLinhas,
      function (sheet, linha, valores) {
        var cell = sheet.getCell(linha, 1);
        var cor = CORES_PRIORIDADE_XLSX[String(valores[0])] ||
          { fundo: CORES_XLSX.marcaClara, texto: CORES_XLSX.marcaEscura };
        pintarCelula(cell, cor.fundo);
        fonteCelula(cell, 10, true, cor.texto);
      }
    );

    var rodape = ws.getCell(proximaLinha, 1);
    rodape.value = "Visual Kanban · dados filtrados no painel no momento da exportação.";
    fonteCelula(rodape, 9, false, CORES_XLSX.suave);

    ws.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
    ws.headerFooter.oddFooter = "&LVisual Kanban&C" + filtrosResumo() + "&R&P de &N";
    return ws;
  }

  function criarAbaKanban(wb, lista) {
    var ws = wb.addWorksheet("Kanban", {
      views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
      properties: { defaultRowHeight: 20 },
    });
    ws.columns = [
      { width: 16 }, { width: 12 }, { width: 11 }, { width: 38 },
      { width: 24 }, { width: 9 }, { width: 9 }, { width: 9 },
      { width: 8 }, { width: 12 }, { width: 12 }, { width: 11 }, { width: 24 },
    ];

    ws.mergeCells("A1:M1");
    var titulo = ws.getCell("A1");
    titulo.value = "KANBAN DE PRODUÇÃO";
    pintarCelula(titulo, CORES_XLSX.marcaEscura);
    fonteCelula(titulo, 20, true, CORES_XLSX.branco);
    alinhamentoCelula(titulo, "left", "middle");
    titulo.alignment.indent = 1;
    ws.getRow(1).height = 40;

    ws.mergeCells("A2:M2");
    var subtitulo = ws.getCell("A2");
    subtitulo.value = VK.num(lista.length) + " pedido(s) exibido(s) · " + filtrosResumo();
    pintarCelula(subtitulo, CORES_XLSX.marcaClara);
    fonteCelula(subtitulo, 10, false, CORES_XLSX.marcaEscura);
    alinhamentoCelula(subtitulo, "left", "middle");
    subtitulo.alignment.indent = 1;
    ws.getRow(2).height = 24;
    ws.getRow(3).height = 8;

    var cabecalhos = [
      "Status", "Pedido", "Cód Confec", "Produto", "Confecção",
      "Saldo", "Prontas", "Quebra", "Q.E", "Entrega",
      "Prioridade", "Progresso", "Atualizado",
    ];
    cabecalhos.forEach(function (texto, indice) {
      var cell = ws.getCell(4, indice + 1);
      cell.value = texto;
      estiloCabecalhoXlsx(cell);
    });
    ws.getRow(4).height = 30;

    lista.forEach(function (p, indice) {
      var linha = 5 + indice;
      var saldo = Math.max(0, Number(p.saldo) || 0);
      var pronta = Math.max(0, Number(p.qtd_pronta) || 0);
      var quebra = Math.min(Math.max(0, Number(p.qtd_quebra) || 0), saldo);
      var qe = Math.max(0, Number(p.qe) || 0);
      var atualizado = p.status_por
        ? p.status_por + " · " + VK.dataHora(p.status_em)
        : "—";
      var valores = [
        p.status || "Pendente",
        p.pedido || "—",
        p.cod_confec || "—",
        p.produto || "—",
        p.confeccao || "Sem Confecção",
        saldo,
        pronta,
        quebra,
        qe,
        dataXlsx(p.dt_entrega),
        p.prioridade || "Baixa",
        progressoPedido(p),
        atualizado,
      ];

      valores.forEach(function (valor, indiceColuna) {
        var cell = ws.getCell(linha, indiceColuna + 1);
        cell.value = valor;
        fonteCelula(cell, 10, false, CORES_XLSX.texto);
        alinhamentoCelula(
          cell,
          [1, 2, 5, 6, 7, 8, 9, 10, 11].indexOf(indiceColuna) >= 0 ? "center" : "left",
          "middle",
          indiceColuna === 3 || indiceColuna === 4
        );
        pintarCelula(cell, indice % 2 ? CORES_XLSX.fundo : CORES_XLSX.branco);
        bordaCelula(cell);
      });

      var statusCell = ws.getCell(linha, 1);
      var corStatus = CORES_STATUS[p.status] || CORES_STATUS["Pendente"];
      pintarCelula(statusCell, corStatus.fundo);
      fonteCelula(statusCell, 10, true, corStatus.texto);

      var prioCell = ws.getCell(linha, 11);
      var corPrio = CORES_PRIORIDADE_XLSX[p.prioridade] || CORES_PRIORIDADE_XLSX["Baixa"];
      pintarCelula(prioCell, corPrio.fundo);
      fonteCelula(prioCell, 10, true, corPrio.texto);

      var quebraCell = ws.getCell(linha, 8);
      if (quebra > 0) {
        pintarCelula(quebraCell, CORES_XLSX.vermelho);
        fonteCelula(quebraCell, 10, true, CORES_XLSX.vermelhoTexto);
      }

      var qeCell = ws.getCell(linha, 9);
      if (qe > 0) {
        pintarCelula(qeCell, CORES_XLSX.ambar);
        fonteCelula(qeCell, 10, true, CORES_XLSX.ambarTexto);
      }

      var entregaCell = ws.getCell(linha, 10);
      if (entregaCell.value instanceof Date) entregaCell.numFmt = "dd/mm/yyyy";

      var progressoCell = ws.getCell(linha, 12);
      progressoCell.numFmt = "0%";
      fonteCelula(progressoCell, 10, true,
        progressoCell.value >= 1 ? CORES_XLSX.verdeTexto :
          progressoCell.value > 0 ? CORES_XLSX.ambarTexto : CORES_XLSX.vermelhoTexto);
      pintarCelula(progressoCell,
        progressoCell.value >= 1 ? CORES_XLSX.verde :
          progressoCell.value > 0 ? CORES_XLSX.ambar : CORES_XLSX.vermelho);

      ws.getRow(linha).height = 24;
    });

    var ultimaLinha = 4 + lista.length;
    ws.autoFilter = "A4:M" + ultimaLinha;

    var rodapeLinha = ultimaLinha + 2;
    ws.mergeCells(rodapeLinha, 1, rodapeLinha, 13);
    var rodape = ws.getCell(rodapeLinha, 1);
    rodape.value = "Gerado pelo Visual Kanban em " + VK.dataHora(new Date().toISOString()) +
      " · use os filtros do painel para exportar recortes específicos.";
    fonteCelula(rodape, 9, false, CORES_XLSX.suave);
    alinhamentoCelula(rodape, "left", "middle");

    ws.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printTitlesRow: "1:4",
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
    ws.headerFooter.oddFooter = "&LVisual Kanban&R&P de &N";
    return ws;
  }

  function baixarExcel(lista) {
    if (!window.ExcelJS) {
      VK.toast("Biblioteca de Excel não carregou. Recarregue o painel com Ctrl+F5.", "error");
      return;
    }

    var botao = VK.$("#btn-exportar");
    if (botao && botao.disabled) return;
    if (botao) {
      botao.disabled = true;
      botao.textContent = "Gerando…";
    }

    var wb = new ExcelJS.Workbook();
    wb.creator = "Visual Kanban";
    wb.lastModifiedBy = "Visual Kanban";
    wb.created = new Date();
    wb.modified = new Date();

    criarAbaResumo(wb, lista);
    criarAbaKanban(wb, lista);

    wb.xlsx.writeBuffer().then(function (buffer) {
      var blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      var nome = "kanban_visual_" + new Date().toISOString().slice(0, 10) + ".xlsx";
      VK.salvarArquivo(blob, nome, function (caminho) {
        VK.toast(caminho
          ? "Excel salvo em " + caminho
          : VK.num(lista.length) + " pedido(s) exportado(s) em Excel.", "ok");
      });
    }).catch(function (erro) {
      VK.toast("Falha ao gerar o Excel: " + (erro && erro.message ? erro.message : erro), "error");
    }).then(function () {
      if (botao) {
        botao.disabled = false;
        botao.textContent = "⤓ Excel";
      }
    });
  }

  function exportarExcel() {
    var lista = filtrados();
    if (!lista.length) { VK.toast("Nada para exportar com os filtros atuais.", "warn"); return; }
    baixarExcel(lista);
  }

  function exportarCSV() {
    var lista = filtrados();
    if (!lista.length) { VK.toast("Nada para exportar com os filtros atuais.", "warn"); return; }

    VK.baixarCSV("kanban_" + new Date().toISOString().slice(0, 10) + ".csv", lista, [
      { titulo: "Pedido", valor: "pedido" },
      { titulo: "Cód Confec", valor: "cod_confec" },
      { titulo: "Produto", valor: "produto" },
      { titulo: "Qtd", valor: "qtd" },
      { titulo: "Saldo", valor: "saldo" },
      { titulo: "Prontas", valor: "qtd_pronta" },
      { titulo: "Quebra", valor: "qtd_quebra" },
      { titulo: "Dt Entrega", valor: function (p) { return VK.dataBR(p.dt_entrega); } },
      { titulo: "Prioridade", valor: "prioridade" },
      { titulo: "Q.E", valor: "qe" },
      { titulo: "Confecção", valor: "confeccao" },
      { titulo: "Status", valor: "status" },
      { titulo: "Atualizado por", valor: "status_por" },
    ], function (caminho) {
      VK.toast(caminho
        ? "CSV salvo em " + caminho
        : VK.num(lista.length) + " pedido(s) exportado(s) em CSV.", "ok");
    });
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

  VK.$("#f-qe").addEventListener("change", function (ev) {
    VK.state.filtros.somenteQe = ev.target.checked;
    VK.$("#lbl-qe").classList.toggle("on", ev.target.checked);
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

  VK.$("#btn-exportar").addEventListener("click", exportarExcel);

  var btnCsv = VK.$("#btn-exportar-csv");
  if (btnCsv) btnCsv.addEventListener("click", exportarCSV);

  // Produção / pronto parcial
  VK.$("#parcial-tudo").addEventListener("click", function () {
    var p = null;
    VK.state.pedidos.forEach(function (x) { if (x.chave === parcialChave) p = x; });
    if (!p) return;
    var saldo = Math.max(0, Number(p.saldo) || 0);
    var inputQuebra = VK.$("#parcial-quebra");
    var brutoQuebra = String(inputQuebra.value || "").trim();
    var quebra = /^\d+$/.test(brutoQuebra) ? parseInt(brutoQuebra, 10) : 0;
    var input = VK.$("#parcial-qtd");
    input.value = String(Math.max(0, saldo - Math.min(quebra, saldo)));
    input.focus();
  });

  VK.$("#parcial-quebra-tudo").addEventListener("click", function () {
    var p = null;
    VK.state.pedidos.forEach(function (x) { if (x.chave === parcialChave) p = x; });
    if (!p) return;
    var saldo = Math.max(0, Number(p.saldo) || 0);
    var inputPronta = VK.$("#parcial-qtd");
    var brutoPronta = String(inputPronta.value || "").trim();
    var pronta = /^\d+$/.test(brutoPronta) ? parseInt(brutoPronta, 10) : 0;
    var inputQuebra = VK.$("#parcial-quebra");
    inputQuebra.value = String(Math.max(0, saldo - Math.min(pronta, saldo)));
    inputQuebra.focus();
  });

  VK.$("#form-parcial").addEventListener("submit", function (ev) {
    ev.preventDefault();

    var p = null;
    VK.state.pedidos.forEach(function (x) { if (x.chave === parcialChave) p = x; });
    if (!p) { VK.toast("Pedido não encontrado. Atualize o quadro.", "warn"); return; }

    var saldo = Math.max(0, Number(p.saldo) || 0);
    var input = VK.$("#parcial-qtd");
    var inputQuebra = VK.$("#parcial-quebra");
    var msg = VK.$("#parcial-msg");
    var bruto = String(input.value || "").trim();
    var brutoQuebra = String(inputQuebra.value || "").trim();

    if (!/^\d+$/.test(bruto)) {
      msg.textContent = "Informe uma quantidade inteira de peças prontas.";
      input.focus();
      return;
    }
    if (!/^\d+$/.test(brutoQuebra)) {
      msg.textContent = "Informe uma quantidade inteira de peças com quebra.";
      inputQuebra.focus();
      return;
    }
    var total = parseInt(bruto, 10);
    var quebra = parseInt(brutoQuebra, 10);
    if (total + quebra > saldo) {
      msg.textContent = "Peças prontas + quebra não podem passar do saldo em aberto (" +
        VK.num(saldo) + " un).";
      input.focus();
      return;
    }

    var btn = this.querySelector('button[type="submit"]');
    msg.textContent = "";
    btn.disabled = true;
    btn.textContent = "Salvando…";

    VK.call("registrarprontoparcial", {
      chave: parcialChave,
      qtd_pronta: total,
      qtd_quebra: quebra
    })
      .then(function (r) {
        VK.fecharDialogo("dlg-parcial");
        var detalhe = VK.num(total) + " prontas" +
          (quebra ? " + " + VK.num(quebra) + " quebra" : "");
        if (r && r.completo) {
          VK.toast("Pedido #" + (p.pedido || "") + " pronto: " + detalhe + ".", "ok");
        } else {
          VK.toast("Produção: " + detalhe + " de " + VK.num(saldo) + " un.", "ok");
        }
        if (quebra > 0 && r && typeof r.qtd_quebra === "undefined") {
          VK.toast("A quebra não foi gravada: publique a versão 1.2.0 do Apps Script.", "warn", 8000);
        }
        VK.atualizarBadges();
        return carregar(false, true);
      })
      .catch(function (e) {
        msg.textContent = e.message || "Não foi possível salvar.";
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "Salvar produção";
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
