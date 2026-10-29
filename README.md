# Visual Kanban

Sistema de acompanhamento da produção das confecções, separado do Visualfil (Streamlit).

O Visualfil continua sendo a fonte dos pedidos. Quando o analista clica em **“Enviar Kanban”**, os
dados são gravados numa planilha do Google Sheets. Este projeto lê e escreve nessa planilha através
de um **Web App do Google Apps Script** — é isso que permite o Kanban rodar em qualquer navegador,
inclusive no celular da confecção, sem depender do app do Visualfil.

O painel é **100% estático** (HTML/CSS/JS). Nesta implantação ele é servido pelo Streamlit Cloud
apenas como hospedagem (`app.py` + `static/`), mas continua podendo ser publicado em qualquer
servidor estático (GitHub Pages, Netlify, servidor interno…).

```
Visualfil (Streamlit)  ──"Enviar Kanban"──▶  Google Sheets  ◀──API JSON──▶  Visual Kanban (este repo)
        pedidos                              (banco de dados)                HTML/CSS/JS estático
```

---

## O que tem aqui

```
visual_kanban/
├── appscript/
│   ├── Code.gs           API completa (login, kanban, chat, admin)
│   └── appsscript.json   manifesto (V8, fuso America/Sao_Paulo)
├── app.py                entrada do Streamlit (redireciona para o painel)
├── .streamlit/
│   └── config.toml       habilita o static serving do Streamlit
├── static/
│   ├── index.html        login + configuração da conexão
│   ├── app.html          painel (Kanban · Chat · Alertas · Administração)
│   ├── css/style.css
│   └── js/
│       ├── config.js     URL da API e intervalos de atualização
│       ├── core.js       cliente HTTP, sessão, utilitários, toasts
│       ├── auth.js       login
│       ├── app.js        navegação, cabeçalho, alertas, polling
│       ├── kanban.js     quadro, filtros, drag & drop, detalhe, CSV
│       ├── chat.js       conversas analista ↔ confecção
│       └── admin.js      usuários e confecções
├── streamlit_integration/
│   └── enviar_kanban.py  cópia de referência do módulo do Visualfil
├── SETUP.md              passo a passo de instalação
└── README.md
```

> O painel é **100% estático** (sem build, sem npm). A pasta `static/` pode ser publicada em
> qualquer hospedagem estática; no Streamlit Cloud, o `app.py` redireciona para
> `/app/static/index.html`.

---

## Funcionalidades

| Área | O que faz |
|---|---|
| **Kanban** | Colunas *A produzir → Em produção → Pronto → Entregue*, com filtros por confecção, prioridade, busca, “só atrasados” e ordenação. Drag & drop e botões. |
| **Confecção** | Vê **somente a sua demanda**. Pode sinalizar *Em produção*, registrar **pronto parcial** e **quebra de tecido** (peças que não virão) e marcar *Pronto* (e voltar atrás). O pedido fecha quando **prontas + quebra** alcançam o saldo. Não consegue marcar *Entregue* nem reabrir um pedido já entregue — isso é feito pelo analista. |
| **Analista** | Vê todas as confecções, move qualquer pedido, confirma entrega, exporta CSV e administra usuários/confecções. O total de **quebra de tecido** aparece no resumo do quadro e na tabela de confecções. |
| **Alertas** | Derivados do quadro (sem tabela extra): atrasos, entregas em até 3 dias, prioridade alta parada e pedidos sem confecção. |
| **Chat** | Conversa direta entre analista e confecção, com contador de não lidas e marcação automática de leitura. |
| **Administração** | Cria/edita/desativa usuários, redefine senhas, edita nomes/aliases das confecções e copia o **código de vínculo**. |
| **Sessão** | Token de 12 h com renovação deslizante; senhas com SHA-256 + salt por usuário. |

---

## O vínculo da confecção (importante)

Cada confecção precisa existir **igual nos dois sistemas**. O elo é um **código estável** gerado a
partir do nome:

```
"J.C. MACEDO'S INDÚSTRIA E COMERCIO DE CONFECCOES EIRELI"
        └──▶  J C MACEDO S INDUSTRIA E COMERCIO DE CONFECCOES EIRELI
        └──▶  J-C-MACEDO-S-INDUSTRIA-E-COMERCIO-DE-CONFECCOES-EIRELI   (código)
```

* O código é gerado no Apps Script (`gerarCodigoConfeccao`) e replicado no Python (`codigo_confeccao`).
* Na aba **Confeccoes** você pode cadastrar **aliases** (nomes antigos). Se o nome mudar na planilha
  de origem, os pedidos continuam caindo no mesmo código — e o histórico de status/chat é preservado.
* O usuário da confecção é cadastrado com `perfil = Confecção` e `codigo_confeccao = <código>`.
* Para descobrir o código, use **Administração → Confecções** ou a tabela mostrada no painel
  “Enviar Kanban” do Visualfil.

---

## Abas da planilha

Criadas automaticamente por `setup()`:

| Aba | Conteúdo |
|---|---|
| `Pedidos` | um registro por pedido enviado (chave estável, status, quem moveu e quando, quantidade pronta parcial e quebra de tecido) |
| `Usuarios` | login, nome, perfil, código da confecção, hash da senha, salt, ativo |
| `Sessoes` | token, usuário, criação, expiração |
| `Confeccoes` | código, nome, aliases, ativo |
| `Chat` | mensagens (`codigo_confeccao`, de, para, perfil, texto, lida) |
| `Log` | auditoria simples de ações |
| `Config` | `ultimo_envio`, `versao` |

---

## API (Apps Script)

Todas as chamadas são `POST` com JSON. O painel envia como `text/plain` (evita o preflight CORS do
Apps Script) e, se a rede bloquear, repete via `GET ?payload=<json>`.

Ações: `ping`, `login`, `logout`, `sessao`, `trocarsenha`, `listarpedidos`, `atualizarstatus`,
`registrarprontoparcial`, `resumo`, `notificacoes`, `listarmensagens`, `enviarmensagem`, `marcarlidas`,
`listarusuarios`, `criarusuario`, `atualizarusuario`, `excluirusuario`, `listarconfeccoes`,
`atualizarconfeccao`, `enviarkanban`.

`enviarkanban` aceita `token` **ou** `user` + `senha` (é o que o Streamlit usa) e exige perfil
`Analista`.

`registrarprontoparcial` recebe `chave`, `qtd_pronta` e `qtd_quebra` (totais acumulados). O pedido
vai para **Pronto** quando `qtd_pronta + qtd_quebra` alcança o `saldo`.

---

## Rodando localmente

1. Siga o **[SETUP.md](SETUP.md)** para criar a planilha e publicar o Apps Script.
2. Preencha `static/js/config.js` com a URL do Web App **ou** use “⚙ Configurar conexão” na tela de
   login (a URL fica salva no navegador).
3. Abra o painel:

   ```bash
   # Opção A — pelo Streamlit (redireciona para o painel)
   python -m streamlit run app.py
   # http://localhost:8501

   # Opção B — servindo a pasta estática diretamente
   python -m http.server 8080 --directory static
   # http://localhost:8080
   ```

No Streamlit Cloud, o app roda a partir de `app.py` e a URL pública
(`https://visualkanban.streamlit.app/`) abre o painel. Se o app foi criado com outro
arquivo principal, troque em **Settings → Main file path** para `app.py`.

Login inicial: **admin / admin123** — troque a senha no primeiro acesso (menu do usuário).

---

## Segurança

* Senhas nunca são gravadas em texto: `SHA-256(salt + "::" + senha)`, salt aleatório por usuário.
* Sessões expiram em 12 h e são renovadas a cada uso; trocar a senha encerra as outras sessões.
* O Web App precisa ser publicado com acesso **“Qualquer pessoa”** (o controle de acesso é feito pela
  API, com token). Não use a URL `/dev` em produção.
* Toda ação administrativa é validada no servidor (`perfil === "Analista"`), não apenas na interface.
* A planilha em si deve ficar restrita à conta que hospeda o Apps Script.
