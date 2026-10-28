/**
 * Visual Kanban - Google Apps Script Backend
 * Atua como API REST para o frontend e como ponte com o Google Sheets.
 *
 * CONFIGURAÇÃO INICIAL:
 *   1. Execute a função `setup()` uma vez para criar todas as abas com cabeçalhos.
 *   2. Implante como Web App (executar como: eu; acesso: qualquer pessoa).
 *   3. Copie a URL do Web App e configure no frontend (config.js) e no Streamlit.
 */

// ==================== CONFIGURAÇÃO ====================

const SHEET_PEDIDOS = "Pedidos";
const SHEET_USUARIOS = "Usuarios";
const SHEET_CHAT = "Chat";
const SHEET_STATUS = "Status";
const SHEET_ALERTAS = "Alertas";

// ==================== SETUP (executar uma vez) ====================

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Aba Usuarios
  let sh = ss.getSheetByName(SHEET_USUARIOS);
  if (!sh) sh = ss.insertSheet(SHEET_USUARIOS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["user", "senha", "perfil", "confecao"]);
    sh.appendRow(["admin", "admin123", "Analista", ""]);
  }

  // Aba Pedidos
  sh = ss.getSheetByName(SHEET_PEDIDOS);
  if (!sh) sh = ss.insertSheet(SHEET_PEDIDOS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["Pedido", "Cód Confec", "Confeccionado", "Qtd", "Saldo", "Dt Entrega",
                  "Confecção", "Marca", "Status", "Prioridade", "Q.E"]);
  }

  // Aba Status
  sh = ss.getSheetByName(SHEET_STATUS);
  if (!sh) sh = ss.insertSheet(SHEET_STATUS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["pedido", "confecao", "status", "atualizado_em", "atualizado_por"]);
  }

  // Aba Chat
  sh = ss.getSheetByName(SHEET_CHAT);
  if (!sh) sh = ss.insertSheet(SHEET_CHAT);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["confecao", "de", "para", "mensagem", "data"]);
  }

  // Aba Alertas
  sh = ss.getSheetByName(SHEET_ALERTAS);
  if (!sh) sh = ss.insertSheet(SHEET_ALERTAS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(["confecao", "pedido", "tipo", "mensagem", "data"]);
  }

  SpreadsheetApp.getUi().alert("Setup concluído! Todas as abas foram criadas.");
}

// ==================== ENTRY POINT (Web App) ====================

function doGet(e) {
  const action = (e.parameter.action || "").toLowerCase();
  const params = e.parameter;

  try {
    switch (action) {
      case "login":
        return jsonResponse(login(params.user, params.senha));
      case "getpedidos":
        return jsonResponse(getPedidos(params.token, params.confecao));
      case "getchat":
        return jsonResponse(getChat(params.token, params.confecao));
      case "getalertas":
        return jsonResponse(getAlertas(params.token, params.confecao));
      case "getallconfeccoes":
        return jsonResponse(getAllConfeccoes(params.token));
      default:
        return jsonResponse({ ok: false, error: "Ação não reconhecida" });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    body = e.parameter;
  }
  const action = (body.action || "").toLowerCase();

  try {
    switch (action) {
      case "login":
        return jsonResponse(login(body.user, body.senha));
      case "enviarkanban":
        return jsonResponse(enviarKanban(body.token, body.dados));
      case "marcarpronto":
        return jsonResponse(marcarPronto(body.token, body.pedido, body.confecao));
      case "enviarmensagem":
        return jsonResponse(enviarMensagem(body.token, body.confecao, body.mensagem, body.destinatario));
      case "criarusuario":
        return jsonResponse(criarUsuario(body.token, body.user, body.senha, body.perfil, body.confecao));
      default:
        return jsonResponse({ ok: false, error: "Ação não reconhecida" });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== AUTENTICAÇÃO ====================

function login(user, senha) {
  if (!user || !senha) return { ok: false, error: "Usuário e senha obrigatórios" };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USUARIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxUser = headers.indexOf("user");
  const idxSenha = headers.indexOf("senha");
  const idxPerfil = headers.indexOf("perfil");
  const idxConf = headers.indexOf("confecao");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxUser]).trim() === String(user).trim() &&
        String(data[i][idxSenha]) === String(senha)) {
      const perfil = data[i][idxPerfil];
      const confecao = data[i][idxConf];
      const token = Utilities.base64Encode(user + ":" + new Date().getTime());
      return { ok: true, token: token, user: user, perfil: perfil, confecao: confecao };
    }
  }
  return { ok: false, error: "Usuário ou senha inválidos" };
}

function validarToken(token) {
  if (!token) return null;
  try {
    const decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    const user = decoded.split(":")[0];
    return user;
  } catch (e) {
    return null;
  }
}

function getPerfil(user) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USUARIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxUser = headers.indexOf("user");
  const idxPerfil = headers.indexOf("perfil");
  const idxConf = headers.indexOf("confecao");
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxUser]).trim() === String(user).trim()) {
      return { perfil: data[i][idxPerfil], confecao: data[i][idxConf] };
    }
  }
  return null;
}

// ==================== ENVIO DO KANBAN ====================

function enviarKanban(token, dados) {
  const user = validarToken(token);
  if (!user) return { ok: false, error: "Token inválido" };
  const perfil = getPerfil(user);
  if (!perfil || perfil.perfil !== "Analista") return { ok: false, error: "Apenas analistas podem enviar o Kanban" };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEDIDOS);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = dados.map(item => headers.map(h => item[h] !== undefined ? item[h] : ""));

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  const statusSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STATUS);
  if (statusSheet.getLastRow() > 1) {
    statusSheet.getRange(2, 1, statusSheet.getLastRow() - 1, statusSheet.getLastColumn()).clearContent();
  }
  const statusHeaders = statusSheet.getRange(1, 1, 1, statusSheet.getLastColumn()).getValues()[0];
  const statusRows = dados.map(item => statusHeaders.map(h => {
    if (h === "pedido") return item["Pedido"] || item["pedido"] || "";
    if (h === "confecao") return item["Confecção"] || item["confeccao"] || item["Confecao"] || "";
    if (h === "status") return "Pendente";
    if (h === "atualizado_em") return new Date();
    if (h === "atualizado_por") return "";
    return item[h] !== undefined ? item[h] : "";
  }));
  if (statusRows.length > 0) {
    statusSheet.getRange(2, 1, statusRows.length, statusHeaders.length).setValues(statusRows);
  }

  gerarAlertas(dados);

  return { ok: true, total: dados.length };
}

// ==================== LEITURA DE PEDIDOS ====================

function getPedidos(token, confecao) {
  const user = validarToken(token);
  if (!user) return { ok: false, error: "Token inválido" };
  const perfil = getPerfil(user);
  if (!perfil) return { ok: false, error: "Usuário não encontrado" };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEDIDOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const statusSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STATUS);
  const statusData = statusSheet.getDataRange().getValues();
  const statusHeaders = statusData[0];
  const idxStatusPedido = statusHeaders.indexOf("pedido");
  const idxStatusConf = statusHeaders.indexOf("confecao");
  const idxStatusVal = statusHeaders.indexOf("status");

  const statusMap = {};
  for (let i = 1; i < statusData.length; i++) {
    const key = String(statusData[i][idxStatusPedido]) + "|" + String(statusData[i][idxStatusConf]);
    statusMap[key] = statusData[i][idxStatusVal];
  }

  const idxConf = headers.indexOf("Confecção");
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const conf = idxConf >= 0 ? row[idxConf] : "";
    if (perfil.perfil === "Confecção" && String(conf).trim() !== String(perfil.confecao).trim()) {
      continue;
    }
    if (confecao && String(conf).trim() !== String(confecao).trim()) {
      continue;
    }
    const item = {};
    headers.forEach((h, j) => { item[h] = row[j]; });
    const key = String(item["Pedido"] || item["pedido"] || "") + "|" + String(conf);
    item["_status"] = statusMap[key] || "Pendente";
    result.push(item);
  }
  return { ok: true, pedidos: result, total: result.length };
}

// ==================== MARCAR PRONTO ====================

function marcarPronto(token, pedido, confecao) {
  const user = validarToken(token);
  if (!user) return { ok: false, error: "Token inválido" };
  const perfil = getPerfil(user);
  if (!perfil) return { ok: false, error: "Usuário não encontrado" };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STATUS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxPedido = headers.indexOf("pedido");
  const idxConf = headers.indexOf("confecao");
  const idxStatus = headers.indexOf("status");
  const idxAtualizado = headers.indexOf("atualizado_em");
  const idxPor = headers.indexOf("atualizado_por");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idxPedido]) === String(pedido) &&
        String(data[i][idxConf]).trim() === String(confecao).trim()) {
      sheet.getRange(i + 1, idxStatus + 1).setValue("Pronto");
      if (idxAtualizado >= 0) sheet.getRange(i + 1, idxAtualizado + 1).setValue(new Date());
      if (idxPor >= 0) sheet.getRange(i + 1, idxPor + 1).setValue(user);
      return { ok: true, pedido: pedido, status: "Pronto" };
    }
  }
  return { ok: false, error: "Pedido não encontrado" };
}

// ==================== CHAT ====================

function getChat(token, confecao) {
  const user = validarToken(token);
  if (!user) return { ok: false, error: "Token inválido" };
  const perfil = getPerfil(user);
  if (!perfil) return { ok: false, error: "Usuário não encontrado" };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CHAT);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxConf = headers.indexOf("confecao");
  const idxMsg = headers.indexOf("mensagem");
  const idxDe = headers.indexOf("de");
  const idxPara = headers.indexOf("para");
  const idxData = headers.indexOf("data");

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const conf = String(data[i][idxConf]).trim();
    if (perfil.perfil === "Confecção" && conf !== String(perfil.confecao).trim()) continue;
    if (confecao && conf !== String(confecao).trim()) continue;
    result.push({ de: data[i][idxDe], para: data[i][idxPara], mensagem: data[i][idxMsg], data: data[i][idxData], confecao: conf });
  }
  return { ok: true, mensagens: result };
}

function enviarMensagem(token, confecao, mensagem, destinatario) {
  const user = validarToken(token);
  if (!user) return { ok: false, error: "Token inválido" };
  const perfil = getPerfil(user);
  if (!perfil) return { ok: false, error: "Usuário não encontrado" };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CHAT);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => {
    if (h === "confecao") return confecao || perfil.confecao;
    if (h === "de") return user;
    if (h === "para") return destinatario || (perfil.perfil === "Analista" ? confecao : "Analista");
    if (h === "mensagem") return mensagem;
    if (h === "data") return new Date();
    return "";
  });
  sheet.appendRow(row);
  return { ok: true };
}

// ==================== ALERTAS ====================

function gerarAlertas(dados) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ALERTAS);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const hoje = new Date();
  const alertas = [];
  dados.forEach(item => {
    const prio = item["Prioridade"] || item["prioridade"] || "";
    if (prio === "Atrasado" || prio === "Alta") {
      alertas.push(headers.map(h => {
        if (h === "confecao") return item["Confecção"] || item["confeccao"] || "";
        if (h === "pedido") return item["Pedido"] || item["pedido"] || "";
        if (h === "tipo") return "Urgência";
        if (h === "mensagem") return "Pedido com prioridade " + prio;
        if (h === "data") return hoje;
        return item[h] !== undefined ? item[h] : "";
      }));
    }
  });
  if (alertas.length > 0) {
    sheet.getRange(2, 1, alertas.length, headers.length).setValues(alertas);
  }
}

function getAlertas(token, confecao) {
  const user = validarToken(token);
  if (!user) return { ok: false, error: "Token inválido" };
  const perfil = getPerfil(user);
  if (!perfil) return { ok: false, error: "Usuário não encontrado" };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ALERTAS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxConf = headers.indexOf("confecao");

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const conf = String(data[i][idxConf]).trim();
    if (perfil.perfil === "Confecção" && conf !== String(perfil.confecao).trim()) continue;
    if (confecao && conf !== String(confecao).trim()) continue;
    const item = {};
    headers.forEach((h, j) => { item[h] = data[i][j]; });
    result.push(item);
  }
  return { ok: true, alertas: result };
}

// ==================== ADMIN ====================

function criarUsuario(token, user, senha, perfil, confecao) {
  const u = validarToken(token);
  if (!u) return { ok: false, error: "Token inválido" };
  const p = getPerfil(u);
  if (!p || p.perfil !== "Analista") return { ok: false, error: "Apenas analistas podem criar usuários" };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USUARIOS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => {
    if (h === "user") return user;
    if (h === "senha") return senha;
    if (h === "perfil") return perfil;
    if (h === "confecao") return confecao || "";
    return "";
  });
  sheet.appendRow(row);
  return { ok: true, user: user };
}

function getAllConfeccoes(token) {
  const user = validarToken(token);
  if (!user) return { ok: false, error: "Token inválido" };
  const perfil = getPerfil(user);
  if (!perfil || perfil.perfil !== "Analista") return { ok: false, error: "Sem permissão" };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEDIDOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxConf = headers.indexOf("Confecção");
  const set = {};
  for (let i = 1; i < data.length; i++) {
    const conf = String(data[i][idxConf]).trim();
    if (conf) set[conf] = true;
  }
  return { ok: true, confeccoes: Object.keys(set).sort() };
}
