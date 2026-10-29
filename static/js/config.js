/* ==========================================================================
   Visual Kanban · configuração
   --------------------------------------------------------------------------
   Cole abaixo a URL do Web App do Google Apps Script (termina em /exec).
   Também é possível configurar pela engrenagem na tela de login — nesse caso
   a URL fica salva no navegador (localStorage) e tem prioridade sobre esta.
   ========================================================================== */

window.VK_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbzM33HyWx_Kqi-y8tA7voUjZL1wz2vxJHhKXfBVVrsfl1cRwrcofuCjTWAM3pDBSmQ/exec",

  // Intervalos de atualização automática (ms)
  pollMs: 20000,
  chatPollMs: 8000,

  // Nome exibido
  appNome: "Visual Kanban",
  versao: "1.2.2",
};
