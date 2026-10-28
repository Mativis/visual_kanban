// kanban.js - quadro de produção
let pedidos = [];

async function carregarPedidos() {
    const user = JSON.parse(localStorage.getItem('vk_user'));
    const data = await apiGet('getpedidos', user.perfil === 'Confecção' ? { confecao: user.confecao } : {});
    if (!data.ok) { alert('Erro: ' + data.error); return; }
    pedidos = data.pedidos || [];
    renderKanban();
}

function renderKanban() {
    const cols = { 'Pendente': [], 'Em andamento': [], 'Pronto': [] };
    pedidos.forEach(p => {
        const status = p._status || 'Pendente';
        if (!cols[status]) cols[status] = [];
        cols[status].push(p);
    });
    Object.keys(cols).forEach(status => {
        const colId = status === 'Pendente' ? 'col-pendente' : status === 'Em andamento' ? 'col-andamento' : 'col-pronto';
        const el = document.getElementById(colId);
        el.innerHTML = '';
        cols[status].forEach(p => {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.innerHTML = `
                <div class="card-title">${p.Pedido || p.pedido || ''}</div>
                <div class="card-meta">
                    Cód: ${p['Cód Confec'] || p.cod_confec || ''}<br>
                    ${p.Confeccionado || p.confeccionado || ''}<br>
                    Qtd: ${p.Qtd || p.qtd || 0} | Saldo: ${p.Saldo || p.saldo || 0}<br>
                    ${p['Dt Entrega'] || p.dt_entrega || ''}
                </div>
                <span class="card-priority priority-${p.Prioridade || p.prioridade || 'Baixa'}">${p.Prioridade || p.prioridade || 'Baixa'}</span>
                ${status !== 'Pronto' ? `<button class="btn-pronto" onclick="marcarPronto('${p.Pedido || p.pedido}', '${p.Confecção || p.confeccao}')">Marcar como Pronto</button>` : '<div class="pronto-badge">✅ Pronto</div>'}
            `;
            el.appendChild(card);
        });
    });
}

async function marcarPronto(pedido, confecao) {
    const user = JSON.parse(localStorage.getItem('vk_user'));
    const res = await apiPost('marcarpronto', { pedido, confecao: confecao || user.confecao });
    if (res.ok) {
        carregarPedidos();
        carregarAlertas();
    } else {
        alert('Erro: ' + (res.error || 'desconhecido'));
    }
}

async function carregarAlertas() {
    const user = JSON.parse(localStorage.getItem('vk_user'));
    const data = await apiGet('getalertas', user.perfil === 'Confecção' ? { confecao: user.confecao } : {});
    if (!data.ok) return;
    const el = document.getElementById('alertas-list');
    el.innerHTML = '';
    (data.alertas || []).forEach(a => {
        const div = document.createElement('div');
        div.className = 'alerta-item';
        div.innerHTML = `<strong>${a.pedido || ''}</strong> — ${a.mensagem || ''} <span style="float:right;font-size:0.8rem;">${a.data || ''}</span>`;
        el.appendChild(div);
    });
    if ((data.alertas || []).length === 0) {
        el.innerHTML = '<p>Nenhum alerta.</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!window.location.pathname.endsWith('kanban.html')) return;
    carregarPedidos();
    carregarAlertas();

    document.getElementById('btn-alertas').addEventListener('click', () => {
        const panel = document.getElementById('alertas-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') carregarAlertas();
    });
});
