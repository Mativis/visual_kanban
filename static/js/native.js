/* ==========================================================================
   Visual Kanban · integração com o app Android (WebView)
   --------------------------------------------------------------------------
   Este arquivo é carregado também no navegador e no Streamlit. Quando o app
   Android não está presente (sem `AndroidBridge`), nada acontece.
   ========================================================================== */
(function () {
  "use strict";

  var VK = window.VK;
  if (!VK) return;

  var bridge = window.AndroidBridge;
  if (!bridge || typeof bridge.saveFile !== "function") return;

  VK.nativo = true;
  document.documentElement.classList.add("app-nativo");

  var pendente = null;

  try {
    VK.appVersao = String(bridge.appVersion() || "");
  } catch (e) {
    VK.appVersao = "";
  }
  try {
    VK.webVersao = String(bridge.otaVersion ? bridge.otaVersion() : "");
  } catch (e) {
    VK.webVersao = "";
  }
  if (!VK.webVersao && VK.config) VK.webVersao = String(VK.config.versao || "");

  /* O Android chama estes retornos depois de gravar (ou falhar) o arquivo. */
  window.VKNative = {
    onSaved: function (caminho) {
      var cb = pendente;
      pendente = null;
      var destino = caminho || "Downloads";
      if (typeof cb === "function") cb(destino);
      else VK.toast("Arquivo salvo em " + destino, "ok");
    },

    onSaveError: function (mensagem) {
      pendente = null;
      VK.toast("Não foi possível salvar o arquivo: " +
        (mensagem || "erro desconhecido"), "error");
    },

    onOtaInfo: function (mensagem) {
      if (mensagem) VK.toast(mensagem, "ok");
    },

    onOtaError: function (mensagem) {
      if (mensagem) VK.toast(mensagem, "error");
    },
  };

  /* No app, troca o download do navegador por gravação em Downloads. */
  VK.salvarArquivo = function (blob, nome, aoConcluir) {
    if (!blob) { VK.toast("Arquivo vazio.", "error"); return; }
    pendente = aoConcluir;

    var leitor = new FileReader();
    leitor.onload = function () {
      var dados = String(leitor.result || "");
      var virgula = dados.indexOf(",");
      var base64 = virgula >= 0 ? dados.slice(virgula + 1) : "";
      if (!base64) {
        pendente = null;
        VK.toast("Não foi possível preparar o arquivo.", "error");
        return;
      }
      try {
        bridge.saveFile(base64, nome || "arquivo", blob.type || "application/octet-stream");
      } catch (e) {
        pendente = null;
        VK.toast("Não foi possível salvar: " +
          (e && e.message ? e.message : e), "error");
      }
    };
    leitor.onerror = function () {
      pendente = null;
      VK.toast("Não foi possível ler o arquivo.", "error");
    };
    leitor.readAsDataURL(blob);
  };

  /* Verificação manual de OTA no menu do usuário. */
  var botaoAtualizar = document.getElementById("btn-verificar-ota");
  if (botaoAtualizar && typeof bridge.checkUpdate === "function") {
    botaoAtualizar.classList.remove("hide");
    botaoAtualizar.addEventListener("click", function () {
      if (botaoAtualizar.disabled) return;
      botaoAtualizar.disabled = true;
      VK.toast("Verificando atualizações…");
      try {
        bridge.checkUpdate();
      } catch (e) {
        VK.toast("Não foi possível verificar: " +
          (e && e.message ? e.message : e), "error");
      }
      setTimeout(function () { botaoAtualizar.disabled = false; }, 6000);
    });
  }

  /* Links externos abrem no navegador do celular. */
  document.addEventListener("click", function (ev) {
    var alvo = ev.target;
    var a = alvo && alvo.closest ? alvo.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) return;
    if (href.indexOf("appassets.androidplatform.net") >= 0) return;
    if (typeof bridge.openUrl === "function") {
      ev.preventDefault();
      bridge.openUrl(a.href);
    }
  });
})();
