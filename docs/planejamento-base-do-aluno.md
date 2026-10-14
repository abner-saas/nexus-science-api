# Planejamento — ficha do aluno, vetor e insight

Decisão alinhada em 14 de outubro de 2026. Ainda não está implementada. O insight
atual continua sendo uma chamada ao `gpt-5.6-luna` (`reasoning_effort: none`,
temperatura `0`) com o JSON dos últimos 7 dias de biofeedback. O texto volta
no campo `ai_insight` do registro mais recente. Não há ficha, vetor nem
reaproveitamento quando os dados não mudam.

## O que vamos construir

Os fatos do aluno ficam nas tabelas que já existem: plano, status, rotina em
andamento, treinos, sessões, biofeedback, avaliação e pagamento. Número e
relação não vão para embedding.

O texto que vale busca fica vetorizado numa tabela do mesmo Postgres: instrução
de exercício, nota do treinador, restrição, insight anterior e, se entrar
depois, um texto curto que a consultoria queira citar. Cada pedaço guarda o
aluno, a origem e o hash do conteúdo. Hash igual não gera embedding de novo.

Na hora de responder, o Luna recebe a ficha atual, os poucos trechos
recuperados e a pergunta. O app e o painel só pedem esse recorte. Nenhum dos
dois monta o prompt. Se o hash da ficha for o mesmo do insight já salvo, a
tela devolve o texto guardado e não chama o modelo.

A restrição médica pode ir nesse pacote, no mesmo provedor que já recebe o
biofeedback. O cadastro grava o aceite dos termos e a versão aceita. O termo
diz que dados de treino e saúde são processados por um provedor de IA para
gerar a orientação. A coluna no Postgres segue cifrada, para o caso de alguém
abrir o banco direto.

## O que fica para quando a carga ou o produto pedirem

Hoje a plataforma é uma consultoria. Estas peças não entram agora:

- Isolamento de várias consultorias. Passa a ser obrigatório no dia em que
  existir o segundo personal. Aí cada linha ganha organização e o banco trava
  o acesso de um personal aos dados do outro. Não precisa de plataforma de
  identidade nem de grafo por cliente para isso.
- Fila. Entra quando gerar embedding ou insight atrasar o salvamento. Hoje a
  escrita é uma linha, e o próprio pedido dá conta.
- Segundo banco de vetores. A busca fica no Postgres até ficar grande demais
  para ele.
- Grafo RDF e ontologia OWL. As entidades já estão nas tabelas. Uma regra
  como “dor alta por três dias pede deload” é código em cima delas.

O desenho não fecha a porta: fatos no Postgres, texto vetorizado na mesma
base, insight só quando a ficha mudou, e toda linha capaz de ganhar
`organizacao_id` quando deixar de ser uma consultoria só.

## Primeiro corte

1. Montar a ficha do aluno a partir das tabelas atuais e gravar o hash.
2. Atualizar a ficha quando mudarem biofeedback, sessão ou rotina.
3. Na geração do insight, pular a chamada ao modelo se o hash não mudou.
4. Gravar no cadastro o aceite dos termos e a versão, autorizando o envio
   dos dados de treino e saúde ao provedor de IA.
5. Só então criar a tabela de trechos, embarcar o texto cujo hash mudou e
   incluir os trechos recuperados no pacote do Luna.
