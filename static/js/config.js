/* ==========================================================================
   Visual Kanban · configuração
   --------------------------------------------------------------------------
   Cole abaixo a URL do Web App do Google Apps Script (termina em /exec).
   Também é possível configurar pela engrenagem na tela de login — nesse caso
   a URL fica salva no navegador (localStorage) e tem prioridade sobre esta.
   ========================================================================== */

window.VK_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbwjep36ezfH5ElRuN_6FkDbOx2-7ndG0xwkWjFh11rmxWSm_avHf07WbwNjt3lnd7wj/exec",

  // Intervalos de atualização automática (ms)
  pollMs: 20000,
  chatPollMs: 8000,

  // Nome exibido
  appNome: "Visual Kanban",
  versao: "1.0.0",
};
