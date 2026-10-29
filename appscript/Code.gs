/**
 * ============================================================================
 *  VISUAL KANBAN · API (Google Apps Script)
 * ============================================================================
 *  Banco de dados: Google Sheets.
 *  Consumido por:
 *    - Streamlit "Visualfil" (botão Enviar Kanban)
 *    - Frontend estático (static/index.html)
 *
 *  PRIMEIROS PASSOS
 *    1. Extensões > Apps Script > cole este arquivo.
 *    2. Execute a função `setup()` UMA vez (cria abas, cabeçalhos e admin).
 *    3. Implantar > Nova implantação > Tipo: App da Web
 *         Executar como: Eu
 *         Quem pode acessar: Qualquer pessoa
 *    4. Copie a URL /exec e informe no frontend (engrenagem na tela de login)
 *       e no painel "Enviar Kanban" do Streamlit.
 *
 *  SEGURANÇA
 *    - Senhas NUNCA são gravadas em texto puro (SHA-256 + salt por usuário).
 *    - Sessões têm validade (12h, renovada ao usar) e ficam na aba Sessoes.
 *    - Permissões: Analista (vê tudo, gerencia usuários) / Confecção (só a sua).
 *
 *  VÍNCULO DA CONFECÇÃO (o "cadastro em comum")
 *    Cada confecção recebe um CÓDIGO estável, gerado a partir do nome:
 *        "J.C. MACEDO'S ... CONFECCOES EIRELI"  ->  "J C MACEDO S ... CONFECCOES EIRELI"
 *    O Streamlit envia o nome; a API gera/acha o código e cadastra a confecção
 *    automaticamente. O usuário da confecção é criado apontando para esse código.
 *    Se o nome mudar na planilha de origem, basta adicionar um ALIAS na aba
 *    Confeccoes — o histórico (status e chat) continua vinculado ao mesmo código.
 * ============================================================================
 */

var VERSAO = "1.2.0";

var ABAS = {
  PEDIDOS: "Pedidos",
  USUARIOS: "Usuarios",
  SESSOES: "Sessoes",
  CONFECCOES: "Confeccoes",
  CHAT: "Chat",
  LOG: "Log",
  CONFIG: "Config"
};

var ESQUEMA = {
  Pedidos: [
    "chave", "pedido", "cod_confec", "produto", "qtd", "saldo", "dt_entrega",
    "confeccao", "codigo_confeccao", "marca", "prioridade", "qe",
    "status", "status_em", "status_por", "enviado_em", "dados_json",
    "qtd_pronta", "pronto_parcial_em", "pronto_parcial_por", "qtd_quebra"
  ],
  Usuarios: [
    "user", "nome", "senha_hash", "salt", "perfil", "codigo_confeccao",
    "ativo", "criado_em", "ultimo_login"
  ],
  Sessoes: ["token", "user", "perfil", "codigo_confeccao", "criado_em", "expira_em"],
  Confeccoes: ["codigo", "nome", "aliases", "ativo", "criado_em"],
  Chat: ["id", "codigo_confeccao", "de", "para", "autor_perfil", "mensagem", "data", "lido"],
  Log: ["data", "user", "perfil", "acao", "detalhe"],
  Config: ["chave", "valor"]
};

var STATUS = ["Pendente", "Em andamento", "Pronto", "Entregue"];
var SESSAO_HORAS = 12;
var MAX_LOG = 5000;

/* ==========================================================================
 *  SETUP
 * ========================================================================== */

/**
 * Cria/ajusta todas as abas e o usuário administrador padrão.
 * Execute uma única vez no editor do Apps Script.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(ESQUEMA).forEach(function (nome) {
    var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
    _garantirCabecalho(sh, ESQUEMA[nome]);
  });

  // Remove a aba padrão "Página1"/"Sheet1", se estiver vazia
  ["Página1", "Sheet1", "Planilha1"].forEach(function (nome) {
    var sh = ss.getSheetByName(nome);
    if (sh && sh.getLastRow() === 0) ss.deleteSheet(sh);
  });

  // Admin inicial
  var usuarios = _lerObjetos(ABAS.USUARIOS);
  if (!usuarios.length) {
    var salt = Utilities.getUuid();
    _anexar(ABAS.USUARIOS, {
      user: "admin",
      nome: "Administrador",
      senha_hash: _hash("admin123", salt),
      salt: salt,
      perfil: "Analista",
      codigo_confeccao: "",
      ativo: true,
      criado_em: _agora(),
      ultimo_login: ""
    });
  }

  _setConfig("versao", VERSAO);
  _setConfig("ultimo_envio", "");

  var msg = "Setup concluído.\n\nAbas: " + Object.keys(ESQUEMA).join(", ") +
    "\n\nUsuário inicial: admin / admin123" +
    "\nTroque a senha no primeiro acesso.";
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}

function _garantirCabecalho(sh, cabecalho) {
  if (!cabecalho || !cabecalho.length) return;
  var atual = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  var igual = atual.length >= cabecalho.length &&
    cabecalho.every(function (h, i) { return String(atual[i]) === h; });
  if (!igual) {
    sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, cabecalho.length)
      .setFontWeight("bold").setBackground("#1e293b").setFontColor("#e2e8f0");
  }
}

/* ==========================================================================
 *  ROTEADOR
 * ========================================================================== */

function doGet(e) {
  return _responder(_executar(e, "GET"));
}

function doPost(e) {
  return _responder(_executar(e, "POST"));
}

function _executar(e, metodo) {
  var p = {};
  try {
    if (metodo === "POST" && e && e.postData && e.postData.contents) {
      p = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      p = e.parameter;
      if (p.payload) p = JSON.parse(p.payload);
    }
  } catch (err) {
    return { ok: false, erro: "Payload inválido: " + err.message };
  }

  var acao = String(p.action || p.acao || "ping").toLowerCase();

  try {
    switch (acao) {
      case "ping":
        return {
          ok: true, versao: VERSAO, hora: _agora(),
          abas: Object.keys(ESQUEMA).length
        };

      case "login":
        return _acaoLogin(p);

      case "logout":
        return _acaoLogout(p);

      case "sessao":
        return _acaoSessao(p);

      case "trocarsenha":
        return _acaoTrocarSenha(p);

      case "enviarkanban":
        return _acaoEnviarKanban(p);

      case "listarpedidos":
        return _acaoListarPedidos(p);

      case "atualizarstatus":
        return _acaoAtualizarStatus(p);

      case "registrarprontoparcial":
        return _acaoRegistrarProntoParcial(p);

      case "resumo":
        return _acaoResumo(p);

      case "notificacoes":
        return _acaoNotificacoes(p);

      case "listarmensagens":
        return _acaoListarMensagens(p);

      case "enviarmensagem":
        return _acaoEnviarMensagem(p);

      case "marcarlidas":
        return _acaoMarcarLidas(p);

      case "listarusuarios":
        return _acaoListarUsuarios(p);

      case "criarusuario":
        return _acaoCriarUsuario(p);

      case "atualizarusuario":
        return _acaoAtualizarUsuario(p);

      case "excluirusuario":
        return _acaoExcluirUsuario(p);

      case "listarconfeccoes":
        return _acaoListarConfeccoes(p);

      case "atualizarconfeccao":
        return _acaoAtualizarConfeccao(p);

      default:
        return { ok: false, erro: "Ação não reconhecida: " + acao };
    }
  } catch (err) {
    return {
      ok: false,
      erro: err && err.message ? err.message : String(err),
      codigo: (err && err.codigo) || "ERRO"
    };
  }
}

function _responder(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==========================================================================
 *  AÇÕES · AUTENTICAÇÃO
 * ========================================================================== */

function _acaoLogin(p) {
  var user = _texto(p.user || p.usuario);
  var senha = String(p.senha || "");
  if (!user || !senha) throw _erro("Informe usuário e senha.", "CREDENCIAIS");

  var u = _buscarUsuario(user);
  if (!u) throw _erro("Usuário ou senha inválidos.", "CREDENCIAIS");
  if (!_bool(u.ativo)) throw _erro("Usuário desativado. Procure o analista.", "INATIVO");
  if (_hash(senha, u.salt) !== String(u.senha_hash)) {
    throw _erro("Usuário ou senha inválidos.", "CREDENCIAIS");
  }

  _limparSessoesVencidas();

  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
  var agora = new Date();
  var expira = new Date(agora.getTime() + SESSAO_HORAS * 3600 * 1000);

  _anexar(ABAS.SESSOES, {
    token: token,
    user: u.user,
    perfil: u.perfil,
    codigo_confeccao: u.codigo_confeccao || "",
    criado_em: agora,
    expira_em: expira
  });

  _atualizarOnde(ABAS.USUARIOS, function (r) { return r.user === u.user; }, { ultimo_login: agora });
  _log(u.user, u.perfil, "login", "");

  var conf = _buscarConfeccao(u.codigo_confeccao);

  return {
    ok: true,
    token: token,
    expira_em: expira.toISOString(),
    usuario: {
      user: u.user,
      nome: u.nome || u.user,
      perfil: u.perfil,
      codigo_confeccao: u.codigo_confeccao || "",
      nome_confeccao: conf ? conf.nome : ""
    }
  };
}

function _acaoLogout(p) {
  var token = _texto(p.token);
  if (token) _excluirOnde(ABAS.SESSOES, function (r) { return r.token === token; });
  return { ok: true };
}

function _acaoSessao(p) {
  var s = _exigirSessao(p);
  var conf = _buscarConfeccao(s.codigo_confeccao);
  return {
    ok: true,
    usuario: {
      user: s.user,
      nome: s.nome || s.user,
      perfil: s.perfil,
      codigo_confeccao: s.codigo_confeccao || "",
      nome_confeccao: conf ? conf.nome : ""
    }
  };
}

function _acaoTrocarSenha(p) {
  var s = _exigirSessao(p);
  var atual = String(p.senha_atual || "");
  var nova = String(p.nova_senha || "");
  if (nova.length < 6) throw _erro("A nova senha deve ter ao menos 6 caracteres.", "VALIDACAO");

  var u = _buscarUsuario(s.user);
  if (!u || _hash(atual, u.salt) !== String(u.senha_hash)) {
    throw _erro("Senha atual incorreta.", "CREDENCIAIS");
  }
  var salt = Utilities.getUuid();
  _atualizarOnde(ABAS.USUARIOS, function (r) { return r.user === u.user; },
    { senha_hash: _hash(nova, salt), salt: salt });
  _excluirOnde(ABAS.SESSOES, function (r) { return r.user === u.user && r.token !== s.token; });
  _log(s.user, s.perfil, "trocar_senha", "");
  return { ok: true };
}

/* ==========================================================================
 *  AÇÕES · KANBAN
 * ========================================================================== */

/**
 * Recebe o Kanban do Streamlit.
 * Preserva o status já sinalizado pela confecção (a não ser que resetar_status).
 * Cadastra automaticamente confecções novas e devolve os códigos gerados.
 */
function _acaoEnviarKanban(p) {
  var s = p.token ? _exigirSessao(p) : _loginSemSessao(p.user || p.usuario, p.senha);
  if (s.perfil !== "Analista") throw _erro("Apenas analistas podem enviar o Kanban.", "SEM_PERMISSAO");

  var dados = p.dados;
  if (typeof dados === "string") dados = JSON.parse(dados);
  if (!dados || !dados.length) throw _erro("Nenhum pedido para enviar.", "VALIDACAO");

  var resetar = _bool(p.resetar_status);
  var agora = new Date();
  var existentes = {};
  _lerObjetos(ABAS.PEDIDOS).forEach(function (r) { existentes[r.chave] = r; });

  var mapa = _mapaConfeccoes();
  var normalizados = [];
  var confsUsadas = {};
  var invalidos = 0;

  dados.forEach(function (item) {
    var pedido = _texto(_pegar(item, ["pedido", "Pedido", "compra", "Compra"]));
    var cod = _texto(_pegar(item, ["cod_confec", "Cód Confec", "Cod Confec"]));
    if (!pedido && !cod) { invalidos++; return; }

    var nomeConf = _texto(_pegar(item, ["confeccao", "Confecção", "Confeccao", "Confecao"])) || "Sem Confecção";
    var codConf = _resolverCodigoConfeccao(nomeConf, mapa);
    confsUsadas[codConf] = nomeConf;

    var dataISO = _dataISO(_pegar(item, ["dt_entrega", "Dt Entrega", "data_entrega"]));
    var compra = _texto(_pegar(item, ["pedido", "Pedido", "compra", "Compra"]));
    var produto = _texto(_pegar(item, ["produto", "Confeccionado", "Descrição", "Descricao"]));

    normalizados.push({
      pedido: pedido,
      compra: compra,
      cod_confec: cod,
      produto: produto,
      qtd: _numero(_pegar(item, ["qtd", "Qtd", "Quantidade"])),
      saldo: _numero(_pegar(item, ["saldo", "Saldo"])),
      dt_entrega: dataISO,
      confeccao: nomeConf,
      codigo_confeccao: codConf,
      marca: _texto(_pegar(item, ["marca", "Marca"])),
      prioridade: _texto(_pegar(item, ["prioridade", "Prioridade"])) || "Baixa",
      qe: _numero(_pegar(item, ["qe", "Q.E", "QE", "Quantidade Emergencial"])),
      dados_json: _jsonResidual(item),
      _ordem: [compra, cod, codConf, produto, dataISO].join("|")
    });
  });

  // Ordena para que a chave (e os sufixos de desempate) sejam estáveis entre envios
  normalizados.sort(function (a, b) { return a._ordem < b._ordem ? -1 : a._ordem > b._ordem ? 1 : 0; });

  var vistos = {};
  var linhas = [];
  var preservados = 0;

  normalizados.forEach(function (n) {
    // A data de entrega NÃO entra na chave: se ela mudar na origem, o status
    // sinalizado pela confecção continua valendo.
    var base = [n.compra, n.cod_confec, n.codigo_confeccao].join("|");
    var chave = base;
    var i = 2;
    while (vistos[chave]) { chave = base + "#" + i; i++; }
    vistos[chave] = true;

    var antigo = existentes[chave];
    var status = "Pendente", statusEm = "", statusPor = "";
    var qtdPronta = 0, qtdQuebra = 0, parcialEm = "", parcialPor = "";
    if (!resetar && antigo) {
      status = antigo.status || "Pendente";
      statusEm = antigo.status_em || "";
      statusPor = antigo.status_por || "";
      qtdPronta = _numero(antigo.qtd_pronta);
      qtdQuebra = _numero(antigo.qtd_quebra);
      parcialEm = antigo.pronto_parcial_em || "";
      parcialPor = antigo.pronto_parcial_por || "";

      // Se o saldo mudou na origem, a produção anterior não representa mais
      // a produção pendente (provavelmente já foi entregue). Recomeça.
      if (_numero(antigo.saldo) !== n.saldo) {
        qtdPronta = 0;
        qtdQuebra = 0;
        parcialEm = "";
        parcialPor = "";
      }
      if (status !== "Pendente") preservados++;
    }

    var saldoAtual = Math.max(0, n.saldo);
    if (status === "Pronto" || status === "Entregue") {
      qtdQuebra = Math.min(Math.max(0, qtdQuebra), saldoAtual);
      qtdPronta = Math.max(0, saldoAtual - qtdQuebra);
      parcialEm = "";
      parcialPor = "";
    } else if (status === "Pendente") {
      qtdPronta = 0;
      qtdQuebra = 0;
      parcialEm = "";
      parcialPor = "";
    } else {
      qtdQuebra = Math.min(Math.max(0, qtdQuebra), saldoAtual);
      qtdPronta = Math.min(Math.max(0, qtdPronta), Math.max(0, saldoAtual - qtdQuebra));
      // Dados antigos podem ter chegado ao saldo sem o status "Pronto";
      // nesse caso o envio apenas regulariza o status.
      if (saldoAtual > 0 && qtdPronta + qtdQuebra >= saldoAtual) {
        status = "Pronto";
        qtdPronta = Math.max(0, saldoAtual - qtdQuebra);
        statusEm = agora;
        statusPor = s.user;
        parcialEm = "";
        parcialPor = "";
      }
    }

    linhas.push({
      chave: chave,
      pedido: n.pedido,
      cod_confec: n.cod_confec,
      produto: n.produto,
      qtd: n.qtd,
      saldo: n.saldo,
      dt_entrega: n.dt_entrega,
      confeccao: n.confeccao,
      codigo_confeccao: n.codigo_confeccao,
      marca: n.marca,
      prioridade: n.prioridade,
      qe: n.qe,
      status: status,
      status_em: statusEm,
      status_por: statusPor,
      enviado_em: agora,
      dados_json: n.dados_json,
      qtd_pronta: qtdPronta,
      pronto_parcial_em: parcialEm,
      pronto_parcial_por: parcialPor,
      qtd_quebra: qtdQuebra
    });
  });

  _substituirLinhas(ABAS.PEDIDOS, linhas);
  _setConfig("ultimo_envio", agora.toISOString());
  _setConfig("ultimo_envio_por", s.user);
  _setConfig("ultimo_envio_total", linhas.length);

  _log(s.user, s.perfil, "enviar_kanban", linhas.length + " pedidos · " +
    Object.keys(confsUsadas).length + " confecções" + (resetar ? " · status reiniciados" : ""));

  var porConf = {};
  linhas.forEach(function (l) {
    var k = l.codigo_confeccao;
    if (!porConf[k]) porConf[k] = { codigo: k, nome: l.confeccao, total: 0, pecas: 0 };
    porConf[k].total++;
    porConf[k].pecas += l.saldo || 0;
  });

  return {
    ok: true,
    total: linhas.length,
    invalidos: invalidos,
    status_preservados: preservados,
    resetado: resetar,
    confeccoes: Object.keys(porConf).map(function (k) { return porConf[k]; })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome); })
  };
}

function _acaoListarPedidos(p) {
  var s = _exigirSessao(p);
  var filtro = _texto(p.codigo_confeccao);
  var pedidos = _pedidosVisiveis(s);

  if (s.perfil === "Analista" && filtro) {
    pedidos = pedidos.filter(function (x) { return x.codigo_confeccao === filtro; });
  }

  var ultimo = _getConfig("ultimo_envio");
  var nomes = {};
  _lerObjetos(ABAS.CONFECCOES).forEach(function (c) { nomes[c.codigo] = c.nome; });

  pedidos = pedidos.map(function (x) {
    var dias = _diasAte(x.dt_entrega);
    var saldo = Math.max(0, _numero(x.saldo));
    var status = STATUS.indexOf(x.status) >= 0 ? x.status : "Pendente";
    var quebra = Math.min(Math.max(0, _numero(x.qtd_quebra)), saldo);
    var pronta = Math.min(Math.max(0, _numero(x.qtd_pronta)), Math.max(0, saldo - quebra));
    if (status === "Pronto" || status === "Entregue") pronta = Math.max(0, saldo - quebra);
    return {
      chave: x.chave,
      pedido: x.pedido,
      cod_confec: x.cod_confec,
      produto: x.produto,
      qtd: x.qtd,
      saldo: saldo,
      dt_entrega: x.dt_entrega,
      confeccao: nomes[x.codigo_confeccao] || x.confeccao,
      codigo_confeccao: x.codigo_confeccao,
      marca: x.marca,
      prioridade: x.prioridade,
      qe: x.qe,
      status: status,
      status_em: x.status_em ? _iso(x.status_em) : "",
      status_por: x.status_por || "",
      qtd_pronta: pronta,
      qtd_quebra: quebra,
      pronto_parcial_em: x.pronto_parcial_em ? _iso(x.pronto_parcial_em) : "",
      pronto_parcial_por: x.pronto_parcial_por || "",
      dias: dias,
      atrasado: dias !== null && dias < 0,
      extras: _parseJson(x.dados_json, {})
    };
  });

  return { ok: true, pedidos: pedidos, total: pedidos.length, ultimo_envio: ultimo };
}

function _acaoAtualizarStatus(p) {
  var s = _exigirSessao(p);
  var chave = _texto(p.chave);
  var novo = _texto(p.status);
  if (!chave) throw _erro("Pedido não informado.", "VALIDACAO");
  if (STATUS.indexOf(novo) < 0) throw _erro("Status inválido: " + novo, "VALIDACAO");

  var alvo = null;
  _lerObjetos(ABAS.PEDIDOS).forEach(function (r) { if (r.chave === chave) alvo = r; });
  if (!alvo) throw _erro("Pedido não encontrado. Recarregue a página.", "NAO_ENCONTRADO");

  if (s.perfil === "Confecção") {
    if (alvo.codigo_confeccao !== s.codigo_confeccao) {
      throw _erro("Você só pode atualizar pedidos da sua confecção.", "SEM_PERMISSAO");
    }
    if (novo === "Entregue") {
      throw _erro("A baixa de entrega é feita pelo analista.", "SEM_PERMISSAO");
    }
  }

  var atual = STATUS.indexOf(alvo.status) >= 0 ? alvo.status : "Pendente";
  if (s.perfil !== "Analista" && atual === "Entregue") {
    throw _erro("Pedido entregue só pode ser reaberto pelo analista.", "SEM_PERMISSAO");
  }

  var permitidas = {
    "Pendente": ["Em andamento"],
    "Em andamento": ["Pendente", "Pronto"],
    "Pronto": ["Em andamento", "Entregue"],
    "Entregue": ["Pronto"]
  };
  if (s.perfil !== "Analista" && permitidas[atual].indexOf(novo) < 0) {
    throw _erro("Transição não permitida: " + atual + " → " + novo, "TRANSICAO");
  }

  var saldo = Math.max(0, _numero(alvo.saldo));
  var quebra = Math.min(Math.max(0, _numero(alvo.qtd_quebra)), saldo);
  if (novo === "Pendente") quebra = 0;
  var qtdPronta = (novo === "Pronto" || novo === "Entregue")
    ? Math.max(0, saldo - quebra)
    : 0;

  _atualizarOnde(ABAS.PEDIDOS, function (r) { return r.chave === chave; }, {
    status: novo,
    status_em: new Date(),
    status_por: s.user,
    qtd_pronta: qtdPronta,
    qtd_quebra: quebra,
    pronto_parcial_em: "",
    pronto_parcial_por: ""
  });
  _log(s.user, s.perfil, "status", chave + " → " + novo +
    (quebra ? " · " + quebra + " quebra" : ""));

  return {
    ok: true, chave: chave, status: novo, anterior: atual,
    qtd_pronta: qtdPronta, qtd_quebra: quebra, saldo: saldo
  };
}

/**
 * Registra a produção do pedido: peças prontas e quebra de tecido
 * (peças que não virão por falta de tecido). As quantidades são TOTAIS
 * acumulados, não incrementos. O pedido fica Pronto quando
 * qtd_pronta + qtd_quebra atinge o saldo em aberto.
 */
function _acaoRegistrarProntoParcial(p) {
  var s = _exigirSessao(p);
  var chave = _texto(p.chave);
  if (!chave) throw _erro("Pedido não informado.", "VALIDACAO");

  var alvo = null;
  _lerObjetos(ABAS.PEDIDOS).forEach(function (r) { if (r.chave === chave) alvo = r; });
  if (!alvo) throw _erro("Pedido não encontrado. Recarregue a página.", "NAO_ENCONTRADO");

  if (s.perfil === "Confecção" && alvo.codigo_confeccao !== s.codigo_confeccao) {
    throw _erro("Você só pode atualizar pedidos da sua confecção.", "SEM_PERMISSAO");
  }

  var atual = STATUS.indexOf(alvo.status) >= 0 ? alvo.status : "Pendente";
  if (atual !== "Pendente" && atual !== "Em andamento") {
    throw _erro("Só é possível registrar produção em pedidos a produzir ou em produção.", "TRANSICAO");
  }

  var saldo = Math.max(0, _numero(alvo.saldo));
  if (saldo <= 0) throw _erro("Este pedido não tem saldo em aberto.", "VALIDACAO");

  var prontaAtual = Math.min(Math.max(0, _numero(alvo.qtd_pronta)), saldo);
  var quebraAtual = Math.min(Math.max(0, _numero(alvo.qtd_quebra)), saldo);
  var temPronta = p.qtd_pronta !== null && p.qtd_pronta !== undefined &&
    String(p.qtd_pronta).trim() !== "";
  var temQuebra = p.qtd_quebra !== null && p.qtd_quebra !== undefined &&
    String(p.qtd_quebra).trim() !== "";
  if (!temPronta && !temQuebra) {
    throw _erro("Informe a quantidade pronta ou a quebra de tecido.", "VALIDACAO");
  }

  function inteiro(valor, rotulo) {
    var txt = String(valor).trim();
    if (!/^\d+$/.test(txt)) {
      throw _erro("Informe uma quantidade inteira de " + rotulo + ".", "VALIDACAO");
    }
    return parseInt(txt, 10);
  }

  var total = temPronta ? inteiro(p.qtd_pronta, "peças prontas") : prontaAtual;
  var quebra = temQuebra ? inteiro(p.qtd_quebra, "peças com quebra de tecido") : quebraAtual;
  if (total + quebra > saldo) {
    throw _erro("Peças prontas + quebra de tecido não podem passar do saldo em aberto (" +
      saldo + " un).", "VALIDACAO");
  }

  var completo = total + quebra >= saldo;
  var patch = {
    qtd_pronta: total,
    qtd_quebra: quebra,
    pronto_parcial_em: (total > 0 || quebra > 0) ? new Date() : "",
    pronto_parcial_por: (total > 0 || quebra > 0) ? s.user : ""
  };

  var novoStatus = atual;
  if (completo) {
    novoStatus = "Pronto";
    patch.status = "Pronto";
    patch.status_em = new Date();
    patch.status_por = s.user;
  } else if ((total > 0 || quebra > 0) && atual === "Pendente") {
    novoStatus = "Em andamento";
    patch.status = "Em andamento";
    patch.status_em = new Date();
    patch.status_por = s.user;
  }

  _atualizarOnde(ABAS.PEDIDOS, function (r) { return r.chave === chave; }, patch);
  _log(s.user, s.perfil, "pronto_parcial",
    chave + " · " + total + "/" + saldo +
    (quebra ? " + " + quebra + " quebra" : "") + (completo ? " (pronto)" : ""));

  return {
    ok: true, chave: chave, status: novoStatus,
    qtd_pronta: total, qtd_quebra: quebra, saldo: saldo, completo: completo
  };
}

function _acaoResumo(p) {
  var s = _exigirSessao(p);
  if (s.perfil !== "Analista") throw _erro("Sem permissão.", "SEM_PERMISSAO");

  var nomes = {};
  _lerObjetos(ABAS.CONFECCOES).forEach(function (c) { nomes[c.codigo] = c.nome; });

  var mapa = {};
  _lerObjetos(ABAS.PEDIDOS).forEach(function (r) {
    var k = r.codigo_confeccao || "SEM-CONFECCAO";
    if (!mapa[k]) {
      mapa[k] = {
        codigo: k, nome: nomes[k] || r.confeccao || k, total: 0, pecas: 0,
        pendente: 0, andamento: 0, pronto: 0, entregue: 0, atrasados: 0,
        parciais: 0, pecas_prontas: 0, pecas_quebra: 0
      };
    }
    var m = mapa[k];
    m.total++;
    m.pecas += Number(r.saldo) || 0;
    var st = STATUS.indexOf(r.status) >= 0 ? r.status : "Pendente";
    if (st === "Pendente") m.pendente++;
    else if (st === "Em andamento") m.andamento++;
    else if (st === "Pronto") m.pronto++;
    else m.entregue++;
    var pronta = Math.max(0, _numero(r.qtd_pronta));
    var quebra = Math.max(0, _numero(r.qtd_quebra));
    m.pecas_prontas += pronta;
    m.pecas_quebra += quebra;
    if ((pronta > 0 || quebra > 0) && st === "Em andamento") m.parciais++;
    var d = _diasAte(r.dt_entrega);
    if (d !== null && d < 0 && st !== "Entregue") m.atrasados++;
  });

  var lista = Object.keys(mapa).map(function (k) { return mapa[k]; })
    .sort(function (a, b) { return a.nome.localeCompare(b.nome); });

  return { ok: true, confeccoes: lista, ultimo_envio: _getConfig("ultimo_envio") };
}

/* ==========================================================================
 *  AÇÕES · ALERTAS E CHAT
 * ========================================================================== */

function _acaoNotificacoes(p) {
  var s = _exigirSessao(p);
  var pedidos = _pedidosVisiveis(s);
  var hoje = _hojeISO();
  var alertas = [];

  pedidos.forEach(function (r) {
    var st = STATUS.indexOf(r.status) >= 0 ? r.status : "Pendente";
    if (st === "Entregue") return;

    var d = _diasAte(r.dt_entrega);
    var base = {
      chave: r.chave,
      pedido: r.pedido,
      cod_confec: r.cod_confec,
      confeccao: r.confeccao,
      codigo_confeccao: r.codigo_confeccao,
      dt_entrega: r.dt_entrega,
      status: st,
      dias: d
    };

    if (d !== null && d < 0 && st !== "Pronto") {
      alertas.push(_alerta("atrasado", 3, base,
        "Atrasado há " + Math.abs(d) + " dia(s)", "Entrega em " + _dataBR(r.dt_entrega)));
    } else if (d !== null && d <= 3 && st !== "Pronto") {
      alertas.push(_alerta("vence", 2, base,
        d === 0 ? "Entrega hoje" : "Entrega em " + d + " dia(s)",
        "Previsto para " + _dataBR(r.dt_entrega)));
    }
    if (String(r.prioridade) === "Alta" && st === "Pendente") {
      alertas.push(_alerta("prioridade", 1, base,
        "Prioridade alta ainda não iniciada", "Inicie a produção deste pedido"));
    }
    if (!r.codigo_confeccao || r.codigo_confeccao === "SEM-CONFECCAO") {
      alertas.push(_alerta("sem_confeccao", 1, base,
        "Pedido sem confecção vinculada", "Cadastre a confecção para direcionar o pedido"));
    }
  });

  alertas.sort(function (a, b) {
    if (b.severidade !== a.severidade) return b.severidade - a.severidade;
    return (a.dias === null ? 999 : a.dias) - (b.dias === null ? 999 : b.dias);
  });

  return {
    ok: true,
    alertas: alertas.slice(0, 300),
    total: alertas.length,
    nao_lidas: _naoLidas(s),
    nao_lidas_por: _naoLidasPor(s),
    ultimo_envio: _getConfig("ultimo_envio"),
    hoje: hoje
  };
}

function _alerta(tipo, severidade, base, titulo, detalhe) {
  var o = { tipo: tipo, severidade: severidade, titulo: titulo, detalhe: detalhe };
  Object.keys(base).forEach(function (k) { o[k] = base[k]; });
  return o;
}

function _acaoListarMensagens(p) {
  var s = _exigirSessao(p);
  var codigo = s.perfil === "Confecção" ? s.codigo_confeccao : _texto(p.codigo_confeccao);
  if (!codigo) throw _erro("Selecione uma confecção.", "VALIDACAO");

  var msgs = _lerObjetos(ABAS.CHAT)
    .filter(function (r) { return r.codigo_confeccao === codigo; })
    .map(function (r) {
      return {
        id: r.id,
        de: r.de,
        para: r.para,
        autor_perfil: r.autor_perfil,
        mensagem: r.mensagem,
        data: r.data ? _iso(r.data) : "",
        lido: _bool(r.lido)
      };
    })
    .sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; });

  var nomes = {};
  _lerObjetos(ABAS.USUARIOS).forEach(function (u) { nomes[u.user] = u.nome || u.user; });
  msgs.forEach(function (m) { m.de_nome = nomes[m.de] || m.de; });

  return { ok: true, mensagens: msgs.slice(-300), codigo_confeccao: codigo };
}

function _acaoEnviarMensagem(p) {
  var s = _exigirSessao(p);
  var codigo = s.perfil === "Confecção" ? s.codigo_confeccao : _texto(p.codigo_confeccao);
  var msg = String(p.mensagem || "").trim();
  if (!codigo) throw _erro("Selecione uma confecção.", "VALIDACAO");
  if (!msg) throw _erro("Mensagem vazia.", "VALIDACAO");
  if (msg.length > 2000) throw _erro("Mensagem muito longa (máx. 2000).", "VALIDACAO");

  var id = String(new Date().getTime()) + "-" + Math.floor(Math.random() * 10000);
  _anexar(ABAS.CHAT, {
    id: id,
    codigo_confeccao: codigo,
    de: s.user,
    para: s.perfil === "Analista" ? codigo : "Analista",
    autor_perfil: s.perfil,
    mensagem: msg,
    data: new Date(),
    lido: false
  });
  _log(s.user, s.perfil, "chat", codigo);

  return { ok: true, id: id, data: new Date().toISOString() };
}

function _acaoMarcarLidas(p) {
  var s = _exigirSessao(p);
  var codigo = s.perfil === "Confecção" ? s.codigo_confeccao : _texto(p.codigo_confeccao);
  if (!codigo) return { ok: true, marcadas: 0 };

  var n = 0;
  _atualizarOnde(ABAS.CHAT, function (r) {
    var minha = s.perfil === "Confecção" ? r.autor_perfil !== "Confecção" : r.autor_perfil === "Confecção";
    if (r.codigo_confeccao === codigo && minha && !_bool(r.lido)) { n++; return true; }
    return false;
  }, { lido: true });

  return { ok: true, marcadas: n };
}

function _naoLidas(s) {
  var mapa = _naoLidasPor(s);
  return Object.keys(mapa).reduce(function (total, k) { return total + mapa[k]; }, 0);
}

/** Mensagens não lidas agrupadas por código de confecção (usado no chat). */
function _naoLidasPor(s) {
  var mapa = {};
  _lerObjetos(ABAS.CHAT).forEach(function (r) {
    if (_bool(r.lido)) return;
    var minha = s.perfil === "Confecção"
      ? (r.codigo_confeccao === s.codigo_confeccao && r.autor_perfil !== "Confecção")
      : (r.autor_perfil === "Confecção");
    if (minha) {
      var k = r.codigo_confeccao || "SEM-CONFECCAO";
      mapa[k] = (mapa[k] || 0) + 1;
    }
  });
  return mapa;
}

/* ==========================================================================
 *  AÇÕES · ADMINISTRAÇÃO (Analista)
 * ========================================================================== */

function _acaoListarUsuarios(p) {
  var s = _exigirSessao(p);
  if (s.perfil !== "Analista") throw _erro("Sem permissão.", "SEM_PERMISSAO");

  var nomes = {};
  _lerObjetos(ABAS.CONFECCOES).forEach(function (c) { nomes[c.codigo] = c.nome; });

  var usuarios = _lerObjetos(ABAS.USUARIOS).map(function (u) {
    return {
      user: u.user,
      nome: u.nome || u.user,
      perfil: u.perfil,
      codigo_confeccao: u.codigo_confeccao || "",
      nome_confeccao: nomes[u.codigo_confeccao] || "",
      ativo: _bool(u.ativo),
      criado_em: u.criado_em ? _iso(u.criado_em) : "",
      ultimo_login: u.ultimo_login ? _iso(u.ultimo_login) : ""
    };
  }).sort(function (a, b) {
    if (a.perfil !== b.perfil) return a.perfil === "Analista" ? -1 : 1;
    return String(a.nome).localeCompare(String(b.nome));
  });

  return { ok: true, usuarios: usuarios };
}

function _acaoCriarUsuario(p) {
  var s = _exigirSessao(p);
  if (s.perfil !== "Analista") throw _erro("Sem permissão.", "SEM_PERMISSAO");

  var user = _texto(p.user).toLowerCase();
  var senha = String(p.senha || "");
  var perfil = _texto(p.perfil);
  var codigo = _texto(p.codigo_confeccao);

  if (!/^[a-z0-9._-]{3,40}$/.test(user)) throw _erro("Usuário inválido (3-40 caracteres: a-z 0-9 . _ -).", "VALIDACAO");
  if (senha.length < 6) throw _erro("Senha deve ter ao menos 6 caracteres.", "VALIDACAO");
  if (["Analista", "Confecção"].indexOf(perfil) < 0) throw _erro("Perfil inválido.", "VALIDACAO");
  if (perfil === "Confecção" && !codigo) throw _erro("Selecione a confecção do usuário.", "VALIDACAO");
  if (_buscarUsuario(user)) throw _erro("Já existe um usuário com esse login.", "DUPLICADO");

  var salt = Utilities.getUuid();
  _anexar(ABAS.USUARIOS, {
    user: user,
    nome: _texto(p.nome) || user,
    senha_hash: _hash(senha, salt),
    salt: salt,
    perfil: perfil,
    codigo_confeccao: perfil === "Confecção" ? codigo : "",
    ativo: true,
    criado_em: new Date(),
    ultimo_login: ""
  });
  _log(s.user, s.perfil, "criar_usuario", user + " (" + perfil + ")");

  return { ok: true, user: user };
}

function _acaoAtualizarUsuario(p) {
  var s = _exigirSessao(p);
  if (s.perfil !== "Analista") throw _erro("Sem permissão.", "SEM_PERMISSAO");

  var user = _texto(p.user).toLowerCase();
  var alvo = _buscarUsuario(user);
  if (!alvo) throw _erro("Usuário não encontrado.", "NAO_ENCONTRADO");

  var patch = {};
  if (p.nome !== undefined) patch.nome = _texto(p.nome) || user;
  if (p.perfil !== undefined) {
    if (["Analista", "Confecção"].indexOf(p.perfil) < 0) throw _erro("Perfil inválido.", "VALIDACAO");
    patch.perfil = p.perfil;
  }
  if (p.codigo_confeccao !== undefined) patch.codigo_confeccao = _texto(p.codigo_confeccao);
  if (p.ativo !== undefined) patch.ativo = _bool(p.ativo);
  if (p.senha) {
    if (String(p.senha).length < 6) throw _erro("Senha deve ter ao menos 6 caracteres.", "VALIDACAO");
    var salt = Utilities.getUuid();
    patch.salt = salt;
    patch.senha_hash = _hash(String(p.senha), salt);
  }

  if (patch.perfil === "Analista") patch.codigo_confeccao = "";
  if (patch.perfil === "Confecção" && !(patch.codigo_confeccao || alvo.codigo_confeccao)) {
    throw _erro("Selecione a confecção do usuário.", "VALIDACAO");
  }

  _atualizarOnde(ABAS.USUARIOS, function (r) { return r.user === user; }, patch);

  if (patch.ativo === false || patch.senha) {
    _excluirOnde(ABAS.SESSOES, function (r) { return r.user === user; });
  }
  _log(s.user, s.perfil, "atualizar_usuario", user);

  return { ok: true };
}

function _acaoExcluirUsuario(p) {
  var s = _exigirSessao(p);
  if (s.perfil !== "Analista") throw _erro("Sem permissão.", "SEM_PERMISSAO");

  var user = _texto(p.user).toLowerCase();
  if (user === s.user) throw _erro("Você não pode excluir o próprio usuário.", "VALIDACAO");
  if (user === "admin") throw _erro("O usuário admin não pode ser excluído.", "VALIDACAO");
  if (!_buscarUsuario(user)) throw _erro("Usuário não encontrado.", "NAO_ENCONTRADO");

  _excluirOnde(ABAS.USUARIOS, function (r) { return r.user === user; });
  _excluirOnde(ABAS.SESSOES, function (r) { return r.user === user; });
  _log(s.user, s.perfil, "excluir_usuario", user);

  return { ok: true };
}

function _acaoListarConfeccoes(p) {
  var s = _exigirSessao(p);
  if (s.perfil !== "Analista") throw _erro("Sem permissão.", "SEM_PERMISSAO");

  var contagem = {};
  _lerObjetos(ABAS.PEDIDOS).forEach(function (r) {
    var k = r.codigo_confeccao || "";
    contagem[k] = (contagem[k] || 0) + 1;
  });

  var lista = _lerObjetos(ABAS.CONFECCOES).map(function (c) {
    return {
      codigo: c.codigo,
      nome: c.nome,
      aliases: c.aliases || "",
      ativo: _bool(c.ativo),
      pedidos: contagem[c.codigo] || 0,
      criado_em: c.criado_em ? _iso(c.criado_em) : ""
    };
  }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });

  // Inclui códigos presentes nos pedidos mas ausentes no cadastro
  var cadastrados = {};
  lista.forEach(function (c) { cadastrados[c.codigo] = true; });
  _lerObjetos(ABAS.PEDIDOS).forEach(function (r) {
    var k = r.codigo_confeccao;
    if (k && !cadastrados[k]) {
      cadastrados[k] = true;
      lista.push({
        codigo: k, nome: r.confeccao || k, aliases: "", ativo: true,
        pedidos: contagem[k] || 0, criado_em: ""
      });
    }
  });

  return { ok: true, confeccoes: lista };
}

function _acaoAtualizarConfeccao(p) {
  var s = _exigirSessao(p);
  if (s.perfil !== "Analista") throw _erro("Sem permissão.", "SEM_PERMISSAO");

  var codigo = _texto(p.codigo);
  if (!codigo) throw _erro("Informe o código da confecção.", "VALIDACAO");

  var patch = {};
  if (p.nome !== undefined) patch.nome = _texto(p.nome);
  if (p.aliases !== undefined) patch.aliases = _texto(p.aliases);
  if (p.ativo !== undefined) patch.ativo = _bool(p.ativo);

  var existe = false;
  _lerObjetos(ABAS.CONFECCOES).forEach(function (c) { if (c.codigo === codigo) existe = true; });

  if (!existe) {
    _anexar(ABAS.CONFECCOES, {
      codigo: codigo,
      nome: patch.nome || codigo,
      aliases: patch.aliases || "",
      ativo: patch.ativo !== undefined ? patch.ativo : true,
      criado_em: new Date()
    });
  } else {
    _atualizarOnde(ABAS.CONFECCOES, function (c) { return c.codigo === codigo; }, patch);
  }

  // Renomeia pedidos existentes
  if (patch.nome) {
    _atualizarOnde(ABAS.PEDIDOS, function (r) { return r.codigo_confeccao === codigo; },
      { confeccao: patch.nome });
  }

  _log(s.user, s.perfil, "atualizar_confeccao", codigo);
  return { ok: true, codigo: codigo };
}

/* ==========================================================================
 *  NÚCLEO · VÍNCULO DE CONFECÇÃO
 * ========================================================================== */

/**
 * Gera o código estável da confecção.
 * "J.C. MACEDO'S INDÚSTRIA" -> "J C MACEDO S INDUSTRIA"
 */
function gerarCodigoConfeccao(nome) {
  var s = _semAcento(nome).toUpperCase();
  s = s.replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "SEM-CONFECCAO";
  return s.replace(/ /g, "-").substring(0, 60);
}

function _semAcento(txt) {
  var mapa = {
    "Á": "A", "À": "A", "Ã": "A", "Â": "A", "Ä": "A",
    "É": "E", "È": "E", "Ê": "E", "Ë": "E",
    "Í": "I", "Ì": "I", "Î": "I", "Ï": "I",
    "Ó": "O", "Ò": "O", "Õ": "O", "Ô": "O", "Ö": "O",
    "Ú": "U", "Ù": "U", "Û": "U", "Ü": "U",
    "Ç": "C", "Ñ": "N",
    "á": "a", "à": "a", "ã": "a", "â": "a", "ä": "a",
    "é": "e", "è": "e", "ê": "e", "ë": "e",
    "í": "i", "ì": "i", "î": "i", "ï": "i",
    "ó": "o", "ò": "o", "õ": "o", "ô": "o", "ö": "o",
    "ú": "u", "ù": "u", "û": "u", "ü": "u",
    "ç": "c", "ñ": "n"
  };
  return String(txt || "").replace(/[^\u0000-\u007E]/g, function (ch) {
    return mapa[ch] !== undefined ? mapa[ch] : ch;
  });
}

function _resolverCodigoConfeccao(nome, mapa) {
  var chave = _chaveNome(nome);
  if (mapa.porNome[chave]) return mapa.porNome[chave];

  var codigo = gerarCodigoConfeccao(nome);
  var existente = mapa.porCodigo[codigo];

  if (!existente) {
    _anexar(ABAS.CONFECCOES, {
      codigo: codigo,
      nome: nome,
      aliases: "",
      ativo: true,
      criado_em: new Date()
    });
    mapa.porCodigo[codigo] = { codigo: codigo, nome: nome, aliases: "" };
  } else if (!mapa.porCodigo[codigo].nome) {
    mapa.porCodigo[codigo].nome = nome;
    _atualizarOnde(ABAS.CONFECCOES, function (c) { return c.codigo === codigo; }, { nome: nome });
  }

  mapa.porNome[chave] = codigo;
  return codigo;
}

function _mapaConfeccoes() {
  var mapa = { porNome: {}, porCodigo: {} };
  _lerObjetos(ABAS.CONFECCOES).forEach(function (c) {
    var item = { codigo: c.codigo, nome: c.nome, aliases: c.aliases || "" };
    mapa.porCodigo[c.codigo] = item;
    mapa.porNome[_chaveNome(c.nome)] = c.codigo;
    if (c.aliases) {
      String(c.aliases).split("|").forEach(function (a) {
        if (_texto(a)) mapa.porNome[_chaveNome(a)] = c.codigo;
      });
    }
  });
  return mapa;
}

function _chaveNome(nome) {
  return _semAcento(nome).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function _buscarConfeccao(codigo) {
  if (!codigo) return null;
  var achou = null;
  _lerObjetos(ABAS.CONFECCOES).forEach(function (c) { if (c.codigo === codigo) achou = c; });
  return achou;
}

/* ==========================================================================
 *  NÚCLEO · SESSÃO E PERMISSÕES
 * ========================================================================== */

function _exigirSessao(p) {
  var token = _texto(p && p.token);
  if (!token) throw _erro("Sessão ausente. Faça login.", "SESSAO_INVALIDA");

  var achou = null;
  _lerObjetos(ABAS.SESSOES).forEach(function (r) { if (r.token === token) achou = r; });
  if (!achou) throw _erro("Sessão expirada. Faça login novamente.", "SESSAO_INVALIDA");

  var expira = achou.expira_em instanceof Date ? achou.expira_em : new Date(achou.expira_em);
  if (!expira || isNaN(expira.getTime()) || expira.getTime() < new Date().getTime()) {
    _excluirOnde(ABAS.SESSOES, function (r) { return r.token === token; });
    throw _erro("Sessão expirada. Faça login novamente.", "SESSAO_INVALIDA");
  }

  var u = _buscarUsuario(achou.user);
  if (!u || !_bool(u.ativo)) {
    _excluirOnde(ABAS.SESSOES, function (r) { return r.token === token; });
    throw _erro("Usuário inativo. Procure o analista.", "SESSAO_INVALIDA");
  }

  // Renovação deslizante (só grava se faltar menos de 6h)
  if (expira.getTime() - new Date().getTime() < 6 * 3600 * 1000) {
    _atualizarOnde(ABAS.SESSOES, function (r) { return r.token === token; },
      { expira_em: new Date(new Date().getTime() + SESSAO_HORAS * 3600 * 1000) });
  }

  return {
    token: token,
    user: u.user,
    nome: u.nome || u.user,
    perfil: u.perfil,
    codigo_confeccao: u.codigo_confeccao || ""
  };
}

function _loginSemSessao(user, senha) {
  var u = _buscarUsuario(_texto(user));
  if (!u || !_bool(u.ativo) || _hash(String(senha || ""), u.salt) !== String(u.senha_hash)) {
    throw _erro("Usuário ou senha inválidos.", "CREDENCIAIS");
  }
  return {
    user: u.user,
    nome: u.nome || u.user,
    perfil: u.perfil,
    codigo_confeccao: u.codigo_confeccao || ""
  };
}

function _buscarUsuario(user) {
  var alvo = null;
  var busca = _texto(user).toLowerCase();
  _lerObjetos(ABAS.USUARIOS).forEach(function (r) {
    if (String(r.user).toLowerCase() === busca) alvo = r;
  });
  return alvo;
}

function _limparSessoesVencidas() {
  var agora = new Date().getTime();
  _excluirOnde(ABAS.SESSOES, function (r) {
    var exp = r.expira_em instanceof Date ? r.expira_em : new Date(r.expira_em);
    return !exp || isNaN(exp.getTime()) || exp.getTime() < agora;
  });
}

function _pedidosVisiveis(s) {
  var todos = _lerObjetos(ABAS.PEDIDOS);
  if (s.perfil === "Confecção") {
    return todos.filter(function (r) { return r.codigo_confeccao === s.codigo_confeccao; });
  }
  return todos;
}

/* ==========================================================================
 *  NÚCLEO · PLANILHA
 * ========================================================================== */

function _aba(nome) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  // Garante que colunas novas (ex.: qtd_pronta) existam sem precisar
  // rodar setup() novamente em uma planilha já em uso.
  if (ESQUEMA[nome]) _garantirCabecalho(sh, ESQUEMA[nome]);
  return sh;
}

function _lerObjetos(nome) {
  var sh = _aba(nome);
  var ultima = sh.getLastRow();
  if (ultima < 2) return [];
  var cab = ESQUEMA[nome] || sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var valores = sh.getRange(2, 1, ultima - 1, cab.length).getValues();
  var vazia = true;
  var out = valores.map(function (linha) {
    var o = {};
    cab.forEach(function (h, i) { o[h] = linha[i]; });
    if (linha.join("") !== "") vazia = false;
    return o;
  });
  return vazia ? [] : out;
}

function _anexar(nome, obj) {
  var sh = _aba(nome);
  var cab = ESQUEMA[nome];
  sh.appendRow(cab.map(function (h) { return obj[h] !== undefined ? obj[h] : ""; }));
}

function _atualizarOnde(nome, filtro, patch) {
  var sh = _aba(nome);
  var cab = ESQUEMA[nome] || sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var ultima = sh.getLastRow();
  if (ultima < 2) return 0;

  var valores = sh.getRange(2, 1, ultima - 1, cab.length).getValues();
  var alterados = 0;

  valores.forEach(function (linha, i) {
    var o = {};
    cab.forEach(function (h, j) { o[h] = linha[j]; });
    if (!filtro(o)) return;
    Object.keys(patch).forEach(function (k) {
      var j = cab.indexOf(k);
      if (j >= 0) linha[j] = patch[k];
    });
    alterados++;
  });

  if (alterados) sh.getRange(2, 1, valores.length, cab.length).setValues(valores);
  return alterados;
}

function _excluirOnde(nome, filtro) {
  var sh = _aba(nome);
  var cab = ESQUEMA[nome];
  var ultima = sh.getLastRow();
  if (ultima < 2) return 0;

  var valores = sh.getRange(2, 1, ultima - 1, cab.length).getValues();
  var mantidas = [];
  valores.forEach(function (linha) {
    var o = {};
    cab.forEach(function (h, i) { o[h] = linha[i]; });
    if (!filtro(o) && linha.join("") !== "") mantidas.push(linha);
  });

  var removidas = valores.length - mantidas.length;
  if (!removidas) return 0;

  sh.getRange(2, 1, valores.length, cab.length).clearContent();
  if (mantidas.length) sh.getRange(2, 1, mantidas.length, cab.length).setValues(mantidas);
  return removidas;
}

function _substituirLinhas(nome, linhas) {
  var sh = _aba(nome);
  var cab = ESQUEMA[nome];
  var ultima = sh.getLastRow();
  if (ultima > 1) sh.getRange(2, 1, ultima - 1, cab.length).clearContent();
  if (!linhas.length) return;

  var valores = linhas.map(function (o) {
    return cab.map(function (h) { return o[h] !== undefined ? o[h] : ""; });
  });
  sh.getRange(2, 1, valores.length, cab.length).setValues(valores);
}

function _getConfig(chave) {
  var valor = "";
  _lerObjetos(ABAS.CONFIG).forEach(function (r) { if (r.chave === chave) valor = r.valor; });
  return valor === "" || valor === null || valor === undefined ? "" : String(valor);
}

function _setConfig(chave, valor) {
  var existe = false;
  _atualizarOnde(ABAS.CONFIG, function (r) {
    if (r.chave === chave) { existe = true; return true; }
    return false;
  }, { valor: valor });
  if (!existe) _anexar(ABAS.CONFIG, { chave: chave, valor: valor });
}

function _log(user, perfil, acao, detalhe) {
  _anexar(ABAS.LOG, {
    data: new Date(),
    user: user,
    perfil: perfil,
    acao: acao,
    detalhe: detalhe
  });
  var sh = _aba(ABAS.LOG);
  if (sh.getLastRow() > MAX_LOG) {
    sh.deleteRows(2, Math.min(1000, sh.getLastRow() - MAX_LOG + 1000));
  }
}

/* ==========================================================================
 *  NÚCLEO · UTILITÁRIOS
 * ========================================================================== */

function _hash(senha, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + "::" + String(senha),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var v = (b & 0xFF).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function _erro(mensagem, codigo) {
  return { message: mensagem, codigo: codigo || "ERRO" };
}

function _pegar(obj, chaves) {
  for (var i = 0; i < chaves.length; i++) {
    var v = obj[chaves[i]];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

function _texto(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function _numero(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  var s = String(v).trim().replace(/[R$\s]/g, "");
  if (s.indexOf(",") >= 0 && s.indexOf(".") >= 0) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.indexOf(",") >= 0) {
    s = s.replace(",", ".");
  }
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}

function _bool(v) {
  return v === true || v === "true" || v === "TRUE" || v === "Sim" || v === "SIM" ||
    v === 1 || v === "1" || v === "verdadeiro";
}

function _jsonResidual(item) {
  try { return JSON.stringify(item); } catch (e) { return "{}"; }
}

function _parseJson(txt, padrao) {
  try { return JSON.parse(txt); } catch (e) { return padrao; }
}

function _agora() {
  return _iso(new Date()) + " " + Utilities.formatDate(new Date(), _tz(), "HH:mm:ss");
}

function _tz() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); }
  catch (e) { return Session.getScriptTimeZone(); }
}

function _hojeISO() {
  return Utilities.formatDate(new Date(), _tz(), "yyyy-MM-dd");
}

function _iso(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    if (isNaN(v.getTime())) return "";
    return v.toISOString();
  }
  return String(v);
}

function _dataISO(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    if (isNaN(v.getTime())) return "";
    return Utilities.formatDate(v, _tz(), "yyyy-MM-dd");
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    var ano = m[3].length === 2 ? "20" + m[3] : m[3];
    return ano + "-" + _pad(m[2]) + "-" + _pad(m[1]);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + "-" + _pad(m[2]) + "-" + _pad(m[3]);
  return "";
}

function _dataBR(iso) {
  if (!iso) return "";
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + "/" + m[2] + "/" + m[1] : String(iso);
}

function _diasAte(iso) {
  if (!iso) return null;
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  var alvo = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  var hoje = new Date(_hojeISO().replace(/-/g, "/")).getTime();
  return Math.round((alvo - hoje) / 86400000);
}

function _pad(n) {
  n = String(n);
  return n.length === 1 ? "0" + n : n;
}
