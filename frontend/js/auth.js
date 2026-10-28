// auth.js - gerenciamento de sessão
// API_URL é definida em config.js

function getToken() { return localStorage.getItem('vk_token'); }
function getUser() { return JSON.parse(localStorage.getItem('vk_user') || 'null'); }
function setSession(token, user) { localStorage.setItem('vk_token', token); localStorage.setItem('vk_user', JSON.stringify(user)); }
function clearSession() { localStorage.removeItem('vk_token'); localStorage.removeItem('vk_user'); }

async function apiGet(action, params = {}) {
    const token = getToken();
    const qs = new URLSearchParams({ action, token, ...params });
    const res = await fetch(`${API_URL}?${qs}`);
    return res.json();
}

async function apiPost(action, body = {}) {
    const token = getToken();
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, token, ...body }),
    });
    return res.json();
}

// Login page
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('user').value;
        const senha = document.getElementById('senha').value;
        const errEl = document.getElementById('login-error');
        errEl.textContent = '';
        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', user, senha }),
            });
            const data = await res.json();
            if (data.ok) {
                setSession(data.token, { user: data.user, perfil: data.perfil, confecao: data.confecao });
                window.location.href = 'kanban.html';
            } else {
                errEl.textContent = data.error || 'Falha no login';
            }
        } catch (err) {
            errEl.textContent = 'Erro de conexão: ' + err.message;
        }
    });
}

// Kanban page auth check
if (window.location.pathname.endsWith('kanban.html')) {
    const user = getUser();
    if (!getToken() || !user) {
        window.location.href = 'index.html';
    } else {
        document.getElementById('user-info').textContent = `${user.user} (${user.perfil})`;
    }
    document.getElementById('btn-logout').addEventListener('click', () => {
        clearSession();
        window.location.href = 'index.html';
    });
}
