/* ==========================================================================
   Visual Kanban · administração (usuários e confecções)
   ========================================================================== */
(function () {
  "use strict";

  var VK = window.VK;
  if (!VK.$("#tabela-usuarios")) return;

  var usuarios = [];
  var confeccoes = [];
  var editando = null;
  var editandoConf = null;

  /* ---------------- Tabelas ---------------- */

  function renderUsuarios() {
    var box = VK.$("#tabela-usuarios");

    if (!usuarios.length) {
      box.innerHTML = '<div class="corpo vazio" style="border:none">Nenhum usuário cadastrado.</div>';
      return;
    }

    box.innerHTML = '<table class="tabela"><thead><tr>' +
      "<th>Usuário</th><th>Perfil</th><th>Confecção</th><th>Situação</th><th></th>" +
      "</tr></thead><tbody>" +
      usuarios.map(function (u) {
        var conf = u.perfil === "Confecção"
          ? (u.nome_confeccao
            ? VK.esc(u.nome_confeccao) + '<div class="sub"><span class="codigo">' +
              VK.esc(u.codigo_confeccao) + "</span></div>"
            : '<span class="sub">não vinculada</span>')
          : '<span class="sub">todas</span>';

        return "<tr>" +
          '<td><div class="nome">' + VK.esc(u.nome) + '</div><div class="sub">' +
          VK.esc(u.user) +
          (u.ultimo_login ? " · acesso " + VK.dataHora(u.ultimo_login) : " · nunca acessou") +
          "</div></td>" +
          '<td><span class="role ' + (u.perfil === "Analista" ? "Analista" : "Confecção") +
          '">' + VK.esc(u.perfil) + "</span></td>" +
          "<td>" + conf + "</td>" +
          "<td>" + (u.ativo
            ? '<span class="tag-ativo">ativo</span>'
            : '<span class="tag-inativo">inativo</span>') + "</td>" +
          '<td><div class="acoes">' +
          '<button class="btn ghost sm" type="button" data-editar="' + VK.esc(u.user) + '">Editar</button>' +
          '<button class="btn ghost sm" type="button" data-toggle="' + VK.esc(u.user) + '">' +
          (u.ativo ? "Desativar" : "Ativar") + "</button>" +
          (u.user !== "admin"
            ? '<button class="btn danger sm" type="button" data-excluir="' + VK.esc(u.user) + '">Excluir</button>'
            : "") +
          "</div></td></tr>";
      }).join("") +
      "</tbody></table>";
  }

  function renderConfeccoes() {
    var box = VK.$("#tabela-confeccoes");

    if (!confeccoes.length) {
      box.innerHTML = '<div class="corpo vazio" style="border:none">' +
        "Nenhuma confecção cadastrada.<br>Elas aparecem aqui após o primeiro “Enviar Kanban”.</div>";
      return;
    }

    box.innerHTML = '<table class="tabela"><thead><tr>' +
      "<th>Confecção</th><th>Código</th><th>Pedidos</th><th>Quebra</th><th></th>" +
      "</tr></thead><tbody>" +
      confeccoes.map(function (c) {
        return "<tr>" +
          '<td><div class="nome">' + VK.esc(c.nome) +
          (c.ativo ? "" : ' <span class="tag-inativo">inativa</span>') +
          (c.aliases ? '<div class="sub">aliases: ' + VK.esc(c.aliases) + "</div>" : "") +
          "</div></td>" +
          '<td><span class="codigo" title="' + VK.esc(c.codigo) + '">' + VK.esc(c.codigo) +
          '<button type="button" data-copiar="' + VK.esc(c.codigo) + '" title="Copiar">⧉</button></span></td>' +
          "<td>" + VK.num(c.pedidos) + "</td>" +
          "<td>" + (Number(c.pecas_quebra) > 0
            ? '<span class="quebra-total">✂ ' + VK.num(c.pecas_quebra) + " un</span>"
            : '<span class="sub">—</span>') + "</td>" +
          '<td><div class="acoes">' +
          '<button class="btn ghost sm" type="button" data-conf="' + VK.esc(c.codigo) + '">Editar</button>' +
          '<button class="btn ghost sm" type="button" data-novo-user="' + VK.esc(c.codigo) + '">+ Usuário</button>' +
          "</div></td></tr>";
      }).join("") +
      "</tbody></table>";
  }

  function renderTudo() {
    renderUsuarios();
    renderConfeccoes();
  }

  function carregarTudo() {
    return Promise.all([
      VK.call("listarusuarios"),
      VK.call("listarconfeccoes"),
      VK.call("resumo").catch(function () { return { confeccoes: [] }; }),
    ]).then(function (rs) {
      usuarios = (rs[0] && rs[0].usuarios) || [];
      confeccoes = (rs[1] && rs[1].confeccoes) || [];
      var resumo = (rs[2] && rs[2].confeccoes) || [];
      var totais = {};
      resumo.forEach(function (c) { totais[c.codigo] = c; });
      confeccoes.forEach(function (c) {
        var t = totais[c.codigo];
        if (!t) return;
        c.pecas_prontas = Number(t.pecas_prontas) || 0;
        c.pecas_quebra = Number(t.pecas_quebra) || 0;
      });
      VK.state.resumo = resumo;
      renderTudo();
    }).catch(function (e) { VK.toast(e.message, "error"); });
  }

  /* ---------------- Formulário de usuário ---------------- */

  function preencherSelect(valor) {
    var sel = VK.$("#u-conf");
    var html = '<option value="">— selecione —</option>';
    confeccoes.forEach(function (c) {
      html += '<option value="' + VK.esc(c.codigo) + '">' +
        VK.esc(c.nome) + " · " + VK.esc(c.codigo) + "</option>";
    });
    sel.innerHTML = html;
    sel.value = valor || "";
  }

  function atualizarCampoConf() {
    var perfil = VK.$("#u-perfil").value;
    VK.$("#campo-conf").classList.toggle("hide", perfil !== "Confecção");
  }

  function abrirUsuario(u, codigoPreSelecionado) {
    editando = u || null;

    VK.$("#usuario-titulo").textContent = u ? "Editar usuário" : "Novo usuário";
    VK.$("#usuario-msg").textContent = "";

    VK.$("#u-user").value = u ? u.user : "";
    VK.$("#u-user").disabled = !!u;
    VK.$("#u-nome").value = u ? u.nome : "";
    VK.$("#u-perfil").value = u ? u.perfil : "Confecção";
    VK.$("#u-senha").value = "";
    VK.$("#u-ativo").checked = u ? u.ativo !== false : true;

    VK.$("#campo-ativo").classList.toggle("hide", !u);
    VK.$("#u-senha-label").textContent = u ? "Nova senha (opcional)" : "Senha";
    VK.$("#u-senha-hint").textContent = u
      ? "Deixe vazio para manter a senha atual."
      : "Mínimo 6 caracteres. Informe ao usuário e peça para trocar no primeiro acesso.";

    preencherSelect(u ? u.codigo_confeccao : codigoPreSelecionado);
    atualizarCampoConf();

    VK.abrirDialogo("dlg-usuario");
    setTimeout(function () {
      (u ? VK.$("#u-nome") : VK.$("#u-user")).focus();
    }, 60);
  }

  function salvarUsuario(ev) {
    ev.preventDefault();

    var msg = VK.$("#usuario-msg");
    var user = VK.$("#u-user").value.trim().toLowerCase();
    var nome = VK.$("#u-nome").value.trim();
    var perfil = VK.$("#u-perfil").value;
    var codigo = VK.$("#u-conf").value;
    var senha = VK.$("#u-senha").value;
    var ativo = VK.$("#u-ativo").checked;

    msg.textContent = "";

    if (!user) { msg.textContent = "Informe o login."; return; }
    if (!editando && senha.length < 6) { msg.textContent = "A senha deve ter ao menos 6 caracteres."; return; }
    if (editando && senha && senha.length < 6) { msg.textContent = "A senha deve ter ao menos 6 caracteres."; return; }
    if (perfil === "Confecção" && !codigo) { msg.textContent = "Selecione a confecção vinculada."; return; }

    var dados = {
      nome: nome,
      perfil: perfil,
      codigo_confeccao: perfil === "Confecção" ? codigo : "",
    };

    var promessa;
    if (editando) {
      dados.user = editando.user;
      dados.ativo = ativo;
      if (senha) dados.senha = senha;
      promessa = VK.call("atualizarusuario", dados);
    } else {
      dados.user = user;
      dados.senha = senha;
      promessa = VK.call("criarusuario", dados);
    }

    promessa
      .then(function () {
        VK.fecharDialogo("dlg-usuario");
        VK.toast(
          editando
            ? "Usuário " + dados.user + " atualizado."
            : "Usuário criado! Login: " + user + " · senha: " + senha,
          "ok",
          editando ? 3800 : 9000
        );
        VK.state.resumo = [];
        return carregarTudo();
      })
      .then(function () { VK.atualizarBadges(); })
      .catch(function (e) { msg.textContent = e.message; });
  }

  /* ---------------- Formulário de confecção ---------------- */

  function abrirConfeccao(c) {
    editandoConf = c;
    VK.$("#c-codigo").textContent = c.codigo;
    VK.$("#c-nome").value = c.nome;
    VK.$("#c-aliases").value = c.aliases || "";
    VK.$("#c-ativo").checked = c.ativo !== false;
    VK.$("#confeccao-msg").textContent = "";
    VK.abrirDialogo("dlg-confeccao");
  }

  function salvarConfeccao(ev) {
    ev.preventDefault();
    if (!editandoConf) return;

    var msg = VK.$("#confeccao-msg");
    var nome = VK.$("#c-nome").value.trim();
    var aliases = VK.$("#c-aliases").value.trim();
    var ativo = VK.$("#c-ativo").checked;

    if (!nome) { msg.textContent = "Informe o nome da confecção."; return; }

    VK.call("atualizarconfeccao", {
      codigo: editandoConf.codigo,
      nome: nome,
      aliases: aliases,
      ativo: ativo,
    })
      .then(function () {
        VK.fecharDialogo("dlg-confeccao");
        VK.toast("Confecção atualizada.", "ok");
        VK.state.resumo = [];
        VK.state.pedidos = [];
        return carregarTudo();
      })
      .then(function () {
        if (VK.state.tab === "kanban") VK.kanban.carregar(false);
      })
      .catch(function (e) { msg.textContent = e.message; });
  }

  /* ---------------- Eventos ---------------- */

  VK.$("#btn-novo-usuario").addEventListener("click", function () { abrirUsuario(null); });
  VK.$("#btn-atualizar-conf").addEventListener("click", function () { carregarTudo(); });

  VK.$("#u-perfil").addEventListener("change", atualizarCampoConf);
  VK.$("#form-usuario").addEventListener("submit", salvarUsuario);
  VK.$("#form-confeccao").addEventListener("submit", salvarConfeccao);

  VK.on(VK.$("#tabela-usuarios"), "click", "[data-editar]", function (ev, el) {
    var user = el.getAttribute("data-editar");
    var u = null;
    usuarios.forEach(function (x) { if (x.user === user) u = x; });
    if (u) abrirUsuario(u);
  });

  VK.on(VK.$("#tabela-usuarios"), "click", "[data-toggle]", function (ev, el) {
    var user = el.getAttribute("data-toggle");
    var u = null;
    usuarios.forEach(function (x) { if (x.user === user) u = x; });
    if (!u) return;
    if (u.ativo && !window.confirm("Desativar o acesso de " + u.nome + "?")) return;

    VK.call("atualizarusuario", { user: user, ativo: !u.ativo })
      .then(function () {
        VK.toast("Usuário " + (u.ativo ? "desativado" : "ativado") + ".", "ok");
        return carregarTudo();
      })
      .catch(function (e) { VK.toast(e.message, "error"); });
  });

  VK.on(VK.$("#tabela-usuarios"), "click", "[data-excluir]", function (ev, el) {
    var user = el.getAttribute("data-excluir");
    if (!window.confirm("Excluir definitivamente o usuário “" + user + "”?")) return;

    VK.call("excluirusuario", { user: user })
      .then(function () {
        VK.toast("Usuário excluído.", "ok");
        return carregarTudo();
      })
      .catch(function (e) { VK.toast(e.message, "error"); });
  });

  VK.on(VK.$("#tabela-confeccoes"), "click", "[data-conf]", function (ev, el) {
    var codigo = el.getAttribute("data-conf");
    var c = null;
    confeccoes.forEach(function (x) { if (x.codigo === codigo) c = x; });
    if (c) abrirConfeccao(c);
  });

  VK.on(VK.$("#tabela-confeccoes"), "click", "[data-copiar]", function (ev, el) {
    ev.stopPropagation();
    VK.copiar(el.getAttribute("data-copiar"));
  });

  VK.on(VK.$("#tabela-confeccoes"), "click", "[data-novo-user]", function (ev, el) {
    abrirUsuario(null, el.getAttribute("data-novo-user"));
  });

  /* ---------------- API pública ---------------- */

  VK.admin = {
    abrir: function () {
      if (!VK.ehAnalista()) return;
      carregarTudo();
    },
  };
})();
