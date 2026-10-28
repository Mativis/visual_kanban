# Integração com o Visualfil (Streamlit)

`enviar_kanban.py` é uma **cópia de referência** do módulo que vive no repositório do Visualfil
(`integracao_kanban_visual.py`, na raiz).

Ele **não** é importado por este repositório — existe aqui para que quem for mover o
`visual_kanban/` para outro lugar continue tendo o arquivo à mão.

## Como usar no Visualfil

1. Copie `enviar_kanban.py` para a raiz do projeto do Visualfil e renomeie para
   `integracao_kanban_visual.py` (ou copie o arquivo original de lá).
2. No fim de `pagina_kanban()`:

   ```python
   try:
       from integracao_kanban_visual import render_enviar_kanban
       render_enviar_kanban(df_kanban, key_prefix="kb")
   except Exception as erro:
       st.info(f"Módulo de envio indisponível: {erro}")
   ```

3. `pip install requests`.

## O que ele faz

* monta o payload a partir do DataFrame do Kanban (`Compra`, `Cód Confec`, `Confeccionado`, `Qtd`,
  `Saldo`, `Dt Entrega`, `Confecção`, `Marca`, `Prioridade`, `Q.E` + extras);
* normaliza datas para `AAAA-MM-DD` e números para `float`;
* envia para a ação `enviarkanban` com `user`/`senha` de um analista;
* mostra a tabela de **códigos de vínculo** das confecções;
* preserva o status já sinalizado pelas confecções (salvo se “Reiniciar status” estiver marcado).

A URL, o usuário e a senha podem vir do formulário, de `st.session_state`, de `st.secrets`
(`kanban_visual_url`, `kanban_visual_user`, `kanban_visual_senha`) ou das variáveis de ambiente
`KANBAN_VISUAL_URL`, `KANBAN_VISUAL_USER`, `KANBAN_VISUAL_SENHA`.
