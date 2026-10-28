# Visual Kanban — Sistema de Acompanhamento de Confecção

Sistema independente de visualização de Kanban, alimentado pelo sistema Streamlit via Google Sheets (AppScript).

## Arquitetura

```
Streamlit (Kanban)  ──►  Google Sheets (AppScript)  ──►  Visual Kanban (Frontend)
     "Enviar Kanban"         Banco de dados              HTML/JS/CSS
```

- **Visualfil** (Streamlit) processa os arquivos e gera o Kanban.
- Botão **"Enviar Kanban"** envia os dados para o Google Sheets via AppScript.
- O **novo sistema de visualização** (HTML/JS) lê os dados do Google Sheets via AppScript API.
- Cada confecção vê **somente a sua demanda**.

## Funcionalidades

- ✅ **Kanban interativo** — colunas: Pendente, Em andamento, Pronto
- ✅ **Marcar pedidos como prontos** — a confecção sinaliza pedidos concluídos
- ✅ **Alertas** — prioridade Alta/Atrasado gera alertas automáticos
- ✅ **Permissões** — Analista (vê tudo) e Confecção (vê apenas a sua demanda)
- ✅ **Chat direto** — comunicação entre Analista e Confecção
- ✅ **Usuário e senha** — autenticação via Google Sheets

## Configuração

### 1. Google Sheets

Crie uma planilha Google com as seguintes abas (sheets):

#### Aba "Usuarios"
| user | senha | perfil | confecao |
|------|-------|--------|----------|
| analista1 | senha123 | Analista | |
| conf_vestis | vestis2026 | Confecção | VESTIS CONFECCOES LTDA |

#### Aba "Pedidos"
Cabeçalhos (mesmos do Kanban do Streamlit): Compra, Cód Confec, Confeccionado, Qtd, Saldo, Dt Entrega, Confecção, Marca, Status, Prioridade, etc.

#### Aba "Status"
| pedido | confecao | status | atualizado_em | atualizado_por |

#### Aba "Chat"
| confecao | de | para | mensagem | data |

#### Aba "Alertas"
| confecao | pedido | tipo | mensagem | data |

### 2. Google Apps Script

1. Na planilha Google, vá em **Extensões → Apps Script**.
2. Cole o conteúdo de `appscript/Code.gs`.
3. Salve e implante como **Web App** (executar como: eu; acesso: qualquer pessoa).
4. Copie a URL do Web App.

### 3. Vinculação (cadastro da confecção)

A vinculação entre o sistema Streamlit e o Visual Kanban é feita pelo **nome da confecção**:
- No Streamlit, a coluna `Confecção` do Kanban contém o nome da confecção (ex: "VESTIS CONFECCOES LTDA").
- No Google Sheets (aba "Usuarios"), o campo `confecao` deve ter o **mesmo nome**.
- No Google Sheets (aba "Pedidos"), a coluna `Confecção` também deve ter o mesmo nome.

Assim, cada confecção vê somente os pedidos onde `Confecção` == seu nome cadastrado.

### 4. Streamlit — Enviar Kanban

No `kanban_confeccao.py`, adicione:

```python
from visual_kanban.streamlit_integration.enviar_kanban import botao_enviar_kanban

# Após gerar o Kanban:
botao_enviar_kanban(df_kanban)
```

Cole a URL do Web App do AppScript quando solicitado.

### 5. Frontend

Abra `frontend/index.html` em um navegador (ou hospede em qualquer servidor estático).
Configure a URL do AppScript em `frontend/js/auth.js` (variável `API_URL`).

## Estrutura de pastas

```
visual_kanban/
├── appscript/
│   └── Code.gs              # Backend Google Apps Script
├── frontend/
│   ├── index.html           # Login
│   ├── kanban.html          # Painel Kanban
│   ├── css/style.css        # Estilos
│   └── js/
│       ├── auth.js          # Autenticação
│       ├── kanban.js        # Kanban board
│       └── chat.js          # Chat
├── streamlit_integration/
│   └── enviar_kanban.py     # Botão para Streamlit
└── docs/
    └── setup.md             # Guia de configuração
```
