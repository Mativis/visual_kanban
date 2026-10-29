/* ==========================================================================
   Visual Kanban · núcleo (namespace, utilitários e cliente da API)
   ========================================================================== */
(function () {
  "use strict";

  var VK = (window.VK = window.VK || {});
  var CFG = window.VK_CONFIG || {};
  var LS_URL = "vk_api_url";
  var LS_SESSAO = "vk_sessao";
  var URL_ANTIGA_ID = "AKfycbwxWwF5JHfKcom83hPgIVd9fiOE4gdOvEUN57PA6m0ZbJpNzbZdYf7gCIcZdf5cHBIp";

  function urlApiInicial() {
    var salva = String(localStorage.getItem(LS_URL) || "").trim();
    // Migra automaticamente a implantação antiga (1.1.0), que não envia qtd_quebra.
    if (salva && salva.indexOf(URL_ANTIGA_ID) >= 0) {
      localStorage.removeItem(LS_URL);
      salva = "";
    }
    return (salva || CFG.apiUrl || "").trim();
  }

  VK.config = {
    apiUrl: urlApiInicial(),
    apiUrlPadrao: String(CFG.apiUrl || "").trim(),
    pollMs: Number(CFG.pollMs) || 20000,
    chatPollMs: Number(CFG.chatPollMs) || 8000,
    appNome: CFG.appNome || "Visual Kanban",
    versao: CFG.versao || "1.0.0",
  };

  VK.state = {
    pedidos: [],
    resumo: [],
    confeccoes: [],
    alertas: [],
    naoLidas: 0,
    naoLidasPor: {},
    ultimoEnvio: "",
    tab: "kanban",
    thread: "",
    arrastando: false,
    filtros: {
      busca: "",
      prioridade: "",
      confeccao: "",
      ordem: "data",
      atrasados: false,
      ocultarEntregues: true,
    },
  };

  /* ---------------- Erros ---------------- */

  VK.ApiError = function (mensagem, codigo, dados) {
    this.name = "ApiError";
    this.message = mensagem || "Erro inesperado";
    this.codigo = codigo || "ERRO";
    this.dados = dados || null;
  };
  VK.ApiError.prototype = Object.create(Error.prototype);
  VK.ApiError.prototype.constructor = VK.ApiError;

  /* ---------------- Sessão e conexão ---------------- */

  VK.setApiUrl = function (url) {
    var limpa = String(url || "").trim();
    localStorage.setItem(LS_URL, limpa);
    VK.config.apiUrl = limpa;
  };

  VK.session = function () {
    try { return JSON.parse(localStorage.getItem(LS_SESSAO) || "null"); }
    catch (e) { return null; }
  };
  VK.setSession = function (sessao) {
    localStorage.setItem(LS_SESSAO, JSON.stringify(sessao || {}));
  };
  VK.patchSession = function (patch) {
    VK.setSession(Object.assign({}, VK.session() || {}, patch || {}));
  };
  VK.logoutLocal = function () { localStorage.removeItem(LS_SESSAO); };
  VK.token = function () { var s = VK.session(); return s && s.token ? s.token : ""; };
  VK.perfil = function () { var s = VK.session(); return s && s.perfil ? s.perfil : ""; };
  VK.ehAnalista = function () { return VK.perfil() === "Analista"; };

  VK.expirarSessao = function () {
    VK.logoutLocal();
    if (location.pathname.indexOf("app.html") >= 0) {
      location.replace("index.html?expirou=1");
    }
  };

  /**
   * Chamada à API.
   * Usa POST com corpo texto (evita o preflight CORS do Apps Script) e
   * cai para GET com ?payload= se a rede bloquear o POST.
   */
  VK.call = function (action, payload, opcoes) {
    payload = payload || {};
    opcoes = opcoes || {};

    if (!VK.config.apiUrl) {
      return Promise.reject(new VK.ApiError(
        "Conexão não configurada. Informe a URL do AppScript na engrenagem.", "SEM_URL"));
    }

    var corpo = Object.assign({ action: action }, payload);
    if (!corpo.token) {
      var t = VK.token();
      if (t) corpo.token = t;
    }

    var url = VK.config.apiUrl;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opcoes.timeout || 30000) : null;

    function limpar() { if (timer) clearTimeout(timer); }

    return fetch(url, {
      method: "POST",
      body: JSON.stringify(corpo),
      redirect: "follow",
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .catch(function () {
        // Fallback: GET com payload na querystring
        var qs = new URLSearchParams({ payload: JSON.stringify(corpo) });
        var sep = url.indexOf("?") >= 0 ? "&" : "?";
        return fetch(url + sep + qs.toString(), { redirect: "follow", cache: "no-store" });
      })
      .then(function (resp) {
        limpar();
        if (!resp || !resp.ok) {
          throw new VK.ApiError("Servidor respondeu com erro " + (resp ? resp.status : "?"), "HTTP");
        }
        return resp.text();
      })
      .then(function (texto) {
        var dados;
        try { dados = JSON.parse(texto); }
        catch (e) {
          throw new VK.ApiError(
            "Resposta inválida do servidor. Confirme se a implantação do AppScript está publicada para \"qualquer pessoa\".",
            "PARSE");
        }
        if (dados && dados.ok === false) {
          if (dados.codigo === "SESSAO_INVALIDA") VK.expirarSessao();
          throw new VK.ApiError(dados.erro || "Erro desconhecido", dados.codigo, dados);
        }
        return dados || { ok: true };
      })
      .catch(function (err) {
        limpar();
        if (err instanceof VK.ApiError) throw err;
        if (err && err.name === "AbortError") {
          throw new VK.ApiError("O servidor demorou para responder. Tente novamente.", "TIMEOUT");
        }
        throw new VK.ApiError("Não foi possível falar com o servidor. Verifique a internet e a URL do AppScript.", "REDE");
      });
  };

  /* ---------------- DOM ---------------- */

  VK.$ = function (sel, raiz) { return (raiz || document).querySelector(sel); };
  VK.$$ = function (sel, raiz) {
    return Array.prototype.slice.call((raiz || document).querySelectorAll(sel));
  };

  VK.on = function (el, evento, seletor, handler) {
    if (!el) return;
    el.addEventListener(evento, function (ev) {
      var alvo = ev.target.closest(seletor);
      if (alvo && el.contains(alvo)) handler(ev, alvo);
    });
  };

  /* ---------------- Formatação ---------------- */

  var ENTIDADES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  VK.esc = function (v) {
    return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, function (c) {
      return ENTIDADES[c];
    });
  };

  VK.num = function (v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n);
  };

  VK.dataBR = function (iso) {
    if (!iso) return "—";
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + "/" + m[2] + "/" + m[1];
    return String(iso);
  };

  VK.dataHora = function (iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  };

  VK.diasTxt = function (n) {
    if (n === null || n === undefined || n === "") return "";
    if (n === 0) return "hoje";
    if (n > 0) return "em " + n + "d";
    return Math.abs(n) + "d atrás";
  };

  VK.classePrazo = function (p) {
    if (p.status === "Pronto" || p.status === "Entregue") return "ok";
    if (p.dias === null || p.dias === undefined) return "";
    if (p.dias < 0) return "atrasado";
    if (p.dias === 0) return "hoje";
    if (p.dias <= 3) return "proximo";
    return "ok";
  };

  VK.iniciais = function (nome) {
    var partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return "?";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  };

  /* ---------------- UI ---------------- */

  VK.toast = function (mensagem, tipo, ms) {
    var box = VK.$("#toasts");
    if (!box) return;
    var ico = { ok: "✓", error: "✕", warn: "!", info: "i" }[tipo] || "i";
    var el = document.createElement("div");
    el.className = "toast " + (tipo || "info");
    el.innerHTML = '<span class="ico">' + ico + "</span><div>" + VK.esc(mensagem) + "</div>";
    box.appendChild(el);
    setTimeout(function () {
      el.classList.add("saindo");
      setTimeout(function () { el.remove(); }, 260);
    }, ms || (tipo === "error" ? 6500 : 3800));
  };

  VK.setBadge = function (id, valor) {
    var el = document.getElementById(id);
    if (!el) return;
    var n = Number(valor) || 0;
    el.textContent = n > 99 ? "99+" : String(n);
    el.classList.toggle("hide", n <= 0);
  };

  VK.abrirDialogo = function (id) {
    var d = document.getElementById(id);
    if (!d) return;
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  };

  VK.fecharDialogo = function (id) {
    var d = document.getElementById(id);
    if (!d) return;
    if (typeof d.close === "function") d.close();
    else d.removeAttribute("open");
  };

  VK.copiar = function (texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () {
        VK.toast("Copiado: " + texto, "ok");
      });
      return;
    }
    var area = document.createElement("textarea");
    area.value = texto;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); VK.toast("Copiado: " + texto, "ok"); }
    catch (e) { VK.toast("Não foi possível copiar.", "error"); }
    area.remove();
  };

  VK.baixarCSV = function (nome, linhas, colunas) {
    var sep = ";";
    var cab = colunas.map(function (c) { return '"' + c.titulo.replace(/"/g, '""') + '"'; }).join(sep);
    var corpo = linhas.map(function (l) {
      return colunas.map(function (c) {
        var v = typeof c.valor === "function" ? c.valor(l) : l[c.valor];
        v = v === null || v === undefined ? "" : String(v);
        return '"' + v.replace(/"/g, '""') + '"';
      }).join(sep);
    }).join("\r\n");
    var blob = new Blob(["\uFEFF" + cab + "\r\n" + corpo], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------------- Diálogo de conexão (compartilhado) ---------------- */

  VK.iniciarDialogoConexao = function () {
    var form = VK.$("#form-conexao");
    if (!form) return;
    var input = VK.$("#conexao-url");
    var msg = VK.$("#conexao-msg");

    function abrir() {
      input.value = VK.config.apiUrl || "";
      msg.textContent = "";
      VK.abrirDialogo("dlg-conexao");
      setTimeout(function () { input.focus(); }, 50);
    }

    VK.$$("[data-abrir-conexao]").forEach(function (b) { b.addEventListener("click", abrir); });

    VK.$("#btn-testar-conexao").addEventListener("click", function () {
      var url = input.value.trim();
      if (!url) { msg.textContent = "Informe a URL do AppScript."; return; }
      var anterior = VK.config.apiUrl;
      VK.setApiUrl(url);
      msg.textContent = "Testando…";
      VK.call("ping", {}, { timeout: 15000 })
        .then(function (r) {
          msg.style.color = "#6ee7b7";
          msg.textContent = "Conectado! Versão " + (r.versao || "?") + " · " + (r.hora || "");
        })
        .catch(function (e) {
          VK.setApiUrl(anterior);
          msg.style.color = "#fca5a5";
          msg.textContent = e.message;
        });
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var url = input.value.trim();
      if (!url) { msg.textContent = "Informe a URL do AppScript."; return; }
      VK.setApiUrl(url);
      VK.fecharDialogo("dlg-conexao");
      VK.toast("Conexão salva.", "ok");
      if (VK.$("#url-atual")) VK.$("#url-atual").textContent = url;
    });
  };
})();
