# Instalação — Visual Kanban

Guia completo, do zero, para colocar o Kanban no ar. Leva ~20 minutos.

> **Resumo do fluxo**
> `Visualfil (Streamlit)` → botão **Enviar Kanban** → `Google Sheets` → `Apps Script (API)` → `Visual Kanban (este projeto)`

---

## 1. Criar a planilha

1. Acesse <https://sheets.new> e crie uma planilha em branco.
2. Dê um nome, por exemplo **Visual Kanban — Produção**.
3. Não precisa criar abas: o `setup()` faz tudo.

> A planilha é o banco de dados. Mantenha-a privada — só a conta que publica o Apps Script precisa
> de acesso.

---

## 2. Colar o backend (Apps Script)

1. Na planilha: **Extensões → Apps Script**.
2. Apague o conteúdo de `Código.gs` e cole **todo** o conteúdo de [`appscript/Code.gs`](appscript/Code.gs).
3. No menu lateral, em **Configurações do projeto**, marque *“Mostrar o arquivo de manifesto
   `appsscript.json`”*.
4. Abra `appsscript.json` e substitua pelo conteúdo de [`appscript/appsscript.json`](appsscript/appsscript.json)
   (fuso `America/Sao_Paulo`, execução como você, acesso público).
5. Salve (Ctrl+S).

---

## 3. Rodar o `setup()` (uma única vez)

O `Code.gs` tem uma função **`setup()`** que:

* cria todas as abas com os cabeçalhos corretos (`Pedidos`, `Usuarios`, `Sessoes`, `Confeccoes`, `Chat`, `Log`, `Config`);
* remove a aba vazia padrão (`Página1`/`Sheet1`);
* grava o usuário inicial **`admin` / `admin123`**;
* registra a versão no `Config`.

Como executar:

1. No editor do Apps Script, no topo, escolha a função **`setup`** na lista (ao lado de ▶ Executar).
2. Clique em **Executar**.
3. Autorize o script na primeira vez
   (*“Revisar permissões” → escolha sua conta → “Avançado” → “Acessar … (não seguro)” → “Permitir”*).
   É seguro: o aviso aparece porque o script é seu, não publicado na loja.
4. Volte à planilha: as 7 abas devem existir.
5. Confira a aba `Usuarios`: deve ter a linha `admin`.

> **Só rode uma vez.** Rodar de novo não apaga dados (o `setup()` só recria o admin se não houver
> nenhum usuário), mas não é necessário.

---

## 4. Publicar a API (Web App)

1. No Apps Script: **Implantar → Nova implantação**.
2. Tipo: **App da Web**.
3. Preencha:
   * **Descrição:** `Visual Kanban API`
   * **Executar como:** *Eu (seu e-mail)*
   * **Quem pode acessar:** **Qualquer pessoa**
4. **Implantar** e copie a **URL do App da Web** — ela termina em **`/exec`**:

   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

> ⚠️ Use sempre a URL `/exec`. A URL `/dev` só funciona para você, logado, e não serve para o
> painel nem para o Streamlit.

> Esta versão do `Code.gs` responde **1.2.3**. O envio filtrado do Visualfil exige essa versão
> (ou superior); em um backend antigo o painel bloqueia o envio parcial por segurança.

Sempre que alterar o `Code.gs`, publique de novo:
**Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar.** A URL continua a mesma.

---

## 5. Conectar o Visual Kanban (painel)

Há **duas** formas — use a que preferir (a do navegador tem prioridade):

**A. Pela tela de login (mais simples)**

1. Abra o painel (**Streamlit Cloud:** `https://visualkanban.streamlit.app/`; localmente:
   `python -m streamlit run app.py`).
2. Clique em **⚙ Configurar conexão**.
3. Cole a URL `/exec` e clique em **Testar conexão** (deve aparecer “Conectado — versão 1.2.3”).
4. **Salvar**. A URL fica no `localStorage` deste navegador.

**B. Editando o arquivo (melhor para publicar para várias pessoas)**

Abra `static/js/config.js` e preencha:

```js
window.VK_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycb.../exec",
  pollMs: 20000,     // atualização do quadro (ms)
  chatPollMs: 8000,  // atualização do chat (ms)
  appNome: "Visual Kanban",
  versao: "1.2.4",
};
```

Pronto: ao abrir o painel, o campo já vem preenchido para todos.

> Se uma URL antiga (versão 1.1.0) estiver salva no navegador, o painel **1.2.4**
> remove automaticamente essa URL e passa a usar a URL do `config.js`. Quando o
> servidor conectado for anterior à **1.2.0**, aparece um aviso no topo do painel
> com o botão **Atualizar painel**. Em caso de dúvida, use **Ctrl+F5**.

### Publicar no Streamlit Cloud (esta implantação)

O painel é estático, mas o Streamlit Cloud pode servi-lo:

1. Crie o app apontando para o repositório `visual_kanban`, branch `main`.
2. Em **Settings → Main file path**, use **`app.py`**.
3. O repositório já traz `.streamlit/config.toml` com `server.enableStaticServing = true`;
   o `app.py` redireciona para o painel em `/app/static/index.html`.
4. Abra a URL do app (`https://visualkanban.streamlit.app/`) — ela abre o login do painel.

> Se o app foi criado com outro arquivo principal (por exemplo,
> `streamlit_integration/enviar_kanban.py`), troque para `app.py`; senão a página fica em branco.

### Outras hospedagens (opcional)

A pasta `static/` é estática. Opções:

* **GitHub Pages:** publique o **conteúdo** de `static/` (por exemplo, copie para `/docs` e
  selecione a pasta `/docs`, ou use um workflow de GitHub Actions). O GitHub Pages não serve
  uma subpasta arbitrária como `/static`.
* **Netlify/Vercel:** use `static` como *publish directory*.
* **Servidor interno / celular na mesma rede:**

  ```bash
  python -m http.server 8080 --directory static
  # computador: http://localhost:8080
  # celular:    http://IP-DO-PC:8080
  ```

> O painel precisa de **HTTPS** (ou `localhost`) para o `localStorage` funcionar em alguns
> navegadores. Streamlit Cloud/GitHub Pages/Netlify já resolvem.

---

## 6. Primeiro acesso e cadastros

1. Entre com **`admin` / `admin123`**.
2. Menu do usuário (canto superior direito) → **Trocar senha**. Faça isso imediatamente.
3. Vá em **Administração**.

### 6.1 Cadastrar as confecções

As confecções são criadas **automaticamente** no primeiro envio do Kanban (o nome vem da planilha de
origem). Depois do primeiro envio elas aparecem em **Administração → Confecções**, com:

* **Código de vínculo** (ex.: `FACCIONISTA-AMERICANA-LTDA`) — é o elo com o usuário;
* nome e **aliases** (nomes antigos).

### 6.2 Criar o usuário de cada confecção

**Administração → + Novo usuário**

| Campo | Valor |
|---|---|
| Login | ex.: `americana` (3–40 caracteres: a-z, 0-9, `.`, `_`, `-`) |
| Nome exibido | ex.: `Faccionista Americana` |
| Perfil | **Confecção** |
| Confecção vinculada | selecione o código correto |
| Senha | mínimo 6 caracteres — informe à confecção |

Atalho: na tabela de **Confecções**, clique em **+ Usuário** — o vínculo já vem preenchido.

Ao entrar, a confecção vê **apenas os pedidos do código vinculado**.

### 6.3 Analistas

Crie outros usuários com perfil **Analista** (sem vínculo de confecção). Eles veem todas as
confecções, movem qualquer pedido, confirmam entrega e administram o sistema.

---

## 7. Conectar o Visualfil (Streamlit)

O módulo [`integracao_kanban_visual.py`](../integracao_kanban_visual.py) fica **no repositório do
Visualfil** (na raiz, ao lado do `app.py`). Ele já é chamado no fim de `pagina_kanban()`.

1. Instale a dependência (já está no `requirements.txt`):

   ```bash
   pip install requests
   ```

2. Rode o Visualfil normalmente e abra a página **Kanban**.
3. No fim da página, abra o painel **📤 Enviar Kanban para o Visual Kanban**.
4. Preencha:
   * **URL do AppScript:** a mesma URL `/exec`;
   * **Usuário analista:** `admin` (ou outro analista);
   * **Senha:** a senha desse usuário.
5. Clique em **🔌 Testar conexão** → deve responder “Conectado — versão 1.2.3”.
6. Clique em **📤 Enviar Kanban**.

O painel mostra:

* quantidade de pedidos e confecções enviadas;
* quantos status já sinalizados foram **preservados**;
* a tabela de **códigos de vínculo** (use para cadastrar os usuários) e um CSV para download.

### Evitar digitar a senha toda vez

Defina variáveis de ambiente (ou `st.secrets`) no servidor do Visualfil:

```toml
# .streamlit/secrets.toml
kanban_visual_url   = "https://script.google.com/macros/s/AKfycb.../exec"
kanban_visual_user  = "admin"
kanban_visual_senha = "sua-senha"
```

ou

```bash
setx KANBAN_VISUAL_URL   "https://script.google.com/macros/s/AKfycb.../exec"
setx KANBAN_VISUAL_USER  "admin"
setx KANBAN_VISUAL_SENHA "sua-senha"
```

O painel também guarda o que foi digitado em `st.session_state` durante a sessão.

### Opções do envio

| Opção | Quando usar |
|---|---|
| **Somente os pedidos filtrados** | envia apenas o que está na tela (confecção, prioridade, busca e filtro de Saldo ≤ 4%) e **preserva** os demais pedidos no Visual Kanban. Pedidos removidos da origem só saem no envio completo. |
| **Todo o quadro** | publica todos os pedidos do Kanban e substitui a versão anterior na planilha: pedidos que saíram do quadro deixam de aparecer. |
| **Reiniciar status dos pedidos** | no envio filtrado, reinicia só os pedidos enviados; no envio completo, todo o quadro. |

O status de cada pedido, porém, é preservado — inclusive se a **data de entrega** mudar na origem
(a chave do pedido é `Compra + Cód Confec + confecção`).

> O envio filtrado exige o Apps Script **1.2.3** ou superior. Se o painel detectar um servidor antigo,
> ele bloqueia o envio parcial para não substituir o quadro inteiro por engano.

---

## 8. O dia a dia

**Analista**

* `Kanban`: acompanha tudo, arrasta cartões, confirma **Entregue**, filtra por confecção, exporta CSV.
* `Chat`: conversa com cada confecção; o contador vermelho mostra mensagens não lidas.
* `Alertas`: atrasos, entregas em ≤ 3 dias, prioridade alta parada e pedidos sem confecção.
* `Administração`: usuários e confecções.

**Confecção**

* Vê só a própria demanda.
* Botões no cartão: **→ Iniciar produção**, **◐ Produção / quebra** e **✓ Marcar como pronto** (e **←** para voltar).
* **Produção / quebra:** informe o total de peças já prontas e o total de peças que não virão por falta de
  tecido. O cartão mostra a barra de progresso e o restante continua em produção; quando **prontas + quebra**
  atingem o saldo em aberto, o pedido vai automaticamente para **Pronto**.
* A quebra fica registrada no cartão, no detalhe e na exportação CSV. Ao marcar **Pronto** manualmente, o
  sistema considera prontas as peças restantes (`saldo - quebra`).
* Não consegue marcar **Entregue** — isso é feito pelo analista.
* Também não consegue reabrir um pedido já **Entregue**; somente o analista pode devolvê-lo para **Pronto**.
* Chat direto com o analista.

**Atualizações automáticas:** o quadro busca novidades a cada 20 s e o chat a cada 8 s (ajustável em
`config.js`).

---

## 9. Manutenção

| Situação | O que fazer |
|---|---|
| Nome da confecção mudou na origem | **Administração → Confecções → Editar** e coloque o nome antigo em **Aliases**, separado por `|`. O código e o histórico continuam. |
| Confecção trocou de responsável | crie um usuário novo (ou redefina a senha em **Editar**). A senha antiga deixa de funcionar na hora. |
| Esqueci a senha do admin | Abra a aba `Usuarios`, apague a linha do `admin` e rode `setup()` de novo (volta `admin`/`admin123`). |
| Quero limpar o quadro | envie **Todo o quadro** com **Reiniciar status** marcado. |
| Preciso ver o que foi feito | aba `Log` (logins, envios, mudanças de status, administração). |
| Atualizei o `Code.gs` | publique uma **nova versão** da implantação. |

---

## 10. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| “Conexão não configurada” | `config.js` vazio e nada salvo no navegador | engrenagem → colar URL `/exec` → Testar → Salvar |
| “Resposta inválida do servidor” | URL `/dev`, página de login do Google ou erro de script | use `/exec`; confirme a implantação “Qualquer pessoa”; rode `ping` no navegador |
| “Sessão expirada” logo após entrar | fuso/relógio ou implantação antiga | publique nova versão; confira `appsscript.json` (`America/Sao_Paulo`) |
| Login não aceita `admin` | `setup()` não rodou | rode `setup()` no editor do Apps Script |
| Confecção não vê pedidos | usuário sem `codigo_confeccao` ou código diferente | **Administração → Usuários → Editar** e selecione a confecção |
| Envio diz “Apenas analistas…” | usuário do Streamlit não é Analista | use um usuário com perfil Analista |
| Status “some” após novo envio | opção **Reiniciar status** marcada ou `Cód Confec`/`Compra` alterados na origem | desmarque a opção; o vínculo do status usa `Compra + Cód Confec + confecção` |
| “O envio filtrado precisa do Apps Script 1.2.3…” | backend antigo | publique o `Code.gs` 1.2.3 ou escolha **Todo o quadro** |
| Erro de CORS no console | POST bloqueado pela rede | o painel já tenta GET como fallback; verifique se a implantação é pública |
| Planilha com dados estranhos | abas editadas à mão | não renomeie/ordene colunas; o cabeçalho é gerado pelo `setup()` |

---

## 11. Segurança — checklist

- [ ] Senha do `admin` trocada.
- [ ] Planilha compartilhada apenas com a conta que publica o script.
- [ ] URL `/exec` distribuída só para quem precisa (ela é pública, mas as ações exigem login).
- [ ] Usuários das confecções com perfil **Confecção** (nunca Analista).
- [ ] Implantação “Executar como: Eu” e “Acesso: Qualquer pessoa”.
- [ ] Nenhuma senha em texto: a API usa SHA-256 + salt por usuário.
