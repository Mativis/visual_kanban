// chat.js - chat direto entre analista e confecção
async function carregarChat() {
    const user = JSON.parse(localStorage.getItem('vk_user'));
    const params = user.perfil === 'Confecção' ? { confecao: user.confecao } : {};
    const data = await apiGet('getchat', params);
    if (!data.ok) return;
    const el = document.getElementById('chat-messages');
    el.innerHTML = '';
    (data.mensagens || []).forEach(m => {
        const div = document.createElement('div');
        const mine = m.de === user.user;
        div.className = 'chat-msg ' + (mine ? 'mine' : 'theirs');
        div.innerHTML = `<div class="meta">${m.de} → ${m.para} · ${m.data || ''}</div><div>${m.mensagem || ''}</div>`;
        el.appendChild(div);
    });
    el.scrollTop = el.scrollHeight;
}

async function enviarMensagem() {
    const user = JSON.parse(localStorage.getItem('vk_user'));
    const msg = document.getElementById('chat-msg').value.trim();
    if (!msg) return;
    const confecao = user.perfil === 'Confecção' ? user.confecao : (prompt('Confecção destinatária:') || '');
    if (!confecao) return;
    const res = await apiPost('enviarmensagem', { mensagem: msg, confecao, destinatario: user.perfil === 'Confecção' ? 'Analista' : confecao });
    if (res.ok) {
        document.getElementById('chat-msg').value = '';
        carregarChat();
    } else {
        alert('Erro: ' + (res.error || 'desconhecido'));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!window.location.pathname.endsWith('kanban.html')) return;
    const btnChat = document.getElementById('btn-chat');
    if (btnChat) {
        btnChat.addEventListener('click', () => {
            const panel = document.getElementById('chat-panel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            if (panel.style.display === 'block') carregarChat();
        });
    }
    const btnSend = document.getElementById('btn-send-msg');
    if (btnSend) btnSend.addEventListener('click', enviarMensagem);
    const input = document.getElementById('chat-msg');
    if (input) input.addEventListener('keypress', (e) => { if (e.key === 'Enter') enviarMensagem(); });
});
