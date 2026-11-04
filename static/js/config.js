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
  // Com a aba do navegador em segundo plano o chat quase não muda: desacelera.
  chatPollOciosoMs: 60000,
  // Sincronização incremental do chat (1 chamada em vez de 3).
  // false força o caminho antigo, útil para voltar atrás sem republicar.
  chatSync: true,

  // Nome exibido
  appNome: "Visual Kanban",
  versao: "1.4.0",
};
