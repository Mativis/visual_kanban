/* ==========================================================================
   Visual Kanban · tela de login
   ========================================================================== */
(function () {
  "use strict";

  var VK = window.VK;
  var form = VK.$("#form-login");
  if (!form) return;

  var campoUser = VK.$("#login-user");
  var campoSenha = VK.$("#login-senha");
  var erro = VK.$("#login-erro");
  var botao = VK.$("#btn-entrar");
  var urlAtual = VK.$("#url-atual");

  // Já autenticado? Vai direto para o painel.
  var sessao = VK.session();
  if (sessao && sessao.token) {
    VK.call("sessao")
      .then(function () { location.replace("app.html"); })
      .catch(function () { VK.logoutLocal(); });
  }

  if (urlAtual) {
    urlAtual.textContent = VK.config.apiUrl || "não configurada";
    urlAtual.title = VK.config.apiUrl || "";
  }

  // Mensagem quando a sessão expira
  if (/[?&]expirou=1/.test(location.search)) {
    erro.textContent = "Sua sessão expirou. Entre novamente.";
  }

  VK.iniciarDialogoConexao();

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    erro.textContent = "";

    var user = campoUser.value.trim();
    var senha = campoSenha.value;

    if (!user || !senha) {
      erro.textContent = "Informe usuário e senha.";
      return;
    }
    if (!VK.config.apiUrl) {
      erro.textContent = "Conexão não configurada. Clique em “Configurar conexão”.";
      return;
    }

    botao.disabled = true;
    botao.innerHTML = '<span class="spinner"></span> Entrando…';

    VK.call("login", { user: user, senha: senha }, { timeout: 25000 })
      .then(function (r) {
        var u = r.usuario || {};
        VK.setSession({
          token: r.token,
          expira_em: r.expira_em,
          user: u.user,
          nome: u.nome,
          perfil: u.perfil,
          codigo_confeccao: u.codigo_confeccao || "",
          nome_confeccao: u.nome_confeccao || "",
        });
        location.replace("app.html");
      })
      .catch(function (e) {
        erro.textContent = e.message;
        botao.disabled = false;
        botao.textContent = "Entrar";
        campoSenha.focus();
        campoSenha.select();
      });
  });

  campoUser.focus();
})();
