# Visual Kanban — Sistema de Acompanhamento de Confecção

Sistema independente de visualização de Kanban, alimentado pelo sistema Streamlit via Google Sheets (AppScript).

## Arquitetura

```
Streamlit (Kanban)  ──►  Google Sheets (AppScript)  ──►  Visual Kanban (Frontend)
     "Enviar Kanban"         Banco de dados              HTML/JS/CSS
```

## Funcionalidades

- ✅ **Kanban interativo** — colunas: Pendente, Em andamento, Pronto
- ✅ **Marcar pedidos como prontos** — a confecção sinaliza conclusão
- ✅ **Alertas** — prioridade Alta/Atrasado gera alertas automáticos
- ✅ **Permissões** — Analista (vê tudo) e Confecção (vê apenas a sua demanda)
- ✅ **Chat direto** — comunicação entre Analista e Confecção
- ✅ **Usuário e senha** — autenticação via Google Sheets

## Configuração

### 1. Google Sheets
Crie uma planilha Google com as abas: Usuarios, Pedidos, Status, Chat, Alertas.

### 2. Google Apps Script
1. Na planilha Google, vá em **Extensões → Apps Script**.
2. Cole o conteúdo de `appscript/Code.gs`.
3. Execute a função `setup()` para criar todas as abas com cabeçalhos.
4. Implante como **Web App** (executar como: eu; acesso: qualquer pessoa).
5. Copie a URL do Web App.

### 3. Vinculação (cadastro da confecção)
A vinculação é feita pelo **nome da confecção**:
- No Streamlit, a coluna `Confecção` do Kanban contém o nome (ex: "VESTIS CONFECCOES LTDA")
- No Google Sheets (aba "Usuarios"), o campo `confecao` deve ter o **mesmo nome**
- Cada confecção vê **somente** os pedidos onde `Confecção` == seu nome cadastrado

### 4. Frontend
Configure a URL do AppScript em `frontend/js/config.js` (variável `API_URL`).
Abra `frontend/index.html` no navegador.

### 5. Streamlit — Enviar Kanban
No `kanban_confeccao.py` do Visualfil, adicione:
```python
from visual_kanban.streamlit_integration.enviar_kanban import botao_enviar_kanban
botao_enviar_kanban(df_kanban)
```
Cole a URL do Web App quando solicitado.

## Estrutura de pastas

```
visual_kanban/
├── appscript/
│   └── Code.gs              # Backend Google Apps Script
├── frontend/
│   ├── index.html           # Login
│   ├── kanban.html          # Painel Kanban interativo
│   ├── css/style.css        # Estilos
│   └── js/
│       ├── config.js        # URL do AppScript (configurar aqui)
│       ├── auth.js          # Autenticação
│       ├── kanban.js        # Kanban board
│       └── chat.js          # Chat
├── streamlit_integration/
│   └── enviar_kanban.py     # Botão para Streamlit
└── README.md
```
