# Testes de interação por teclado com Q-learning

Fernando Andrade Lima Tavares - Faculdade de Tecnologia da Baixada Santista Rubens Lara.

Este projeto gera sequências de teclas para testar tarefas em páginas web. O agente em Haskell escolhe as ações e atualiza a tabela Q conforme os resultados. O código em JavaScript controla o navegador, envia as teclas e observa o que acontece na página. O oráculo reúne as regras que comparam essas respostas com o comportamento esperado em cada etapa.

Além do código, o repositório contém os registros usados no artigo, os casos de teste e as imagens que ajudam a entender os resultados.

## O que foi testado

A coleta foi realizada em 11/11/2026, com três episódios por fluxo, semente 20261015 e limite de 2500 teclas por episódio. Cada episódio corresponde a uma rodada de teste. A cobertura acumulada conta as transições confirmadas ao longo dessas rodadas, sem contar a mesma transição duas vezes.

| Página | Tarefa | Teclas por episódio | Cobertura acumulada |
| --- | --- | --- | --- |
| [gov.br](https://www.gov.br/pt-br) | Abrir, percorrer e fechar o menu principal | 96, 57, 45 | 8/8 (100%) |
| [Instituto Brasileiro de Geografia e Estatística (IBGE)](https://www.ibge.gov.br/cidades-e-estados/sp/santos.html) | Consultar o valor de 2010 no gráfico de escolarização de Santos | 21, 29, 21 | 7/8 (87,5%) |
| [Banco Mundial](https://data.worldbank.org/indicator/SP.POP.TOTL) | Trocar o gráfico de população total de linhas para barras | 27, 35, 27 | 7/9 (77,78%) |

No IBGE, o ponto de 2010 recebeu foco, mas Enter e Espaço não disponibilizaram o valor nas saídas verificadas pelo oráculo. Essa etapa corresponde à transição I08. No Banco Mundial, Tab levou o foco da licença até Also Show sem alcançar Bar, na transição B08. Por isso, a seleção por Enter, prevista em B09, ficou sem tentativa. Essas diferenças entre o resultado esperado e o observado voltaram a ocorrer na reaplicação dos casos de 21 e 27 teclas durante a coleta.

Os percentuais mostram quanto de cada modelo foi coberto pelos testes. O resultado de 100% no menu, por exemplo, significa que as oito transições desse fluxo foram confirmadas. A avaliação se limita às tarefas e às condições registradas; não certifica a acessibilidade completa das plataformas. A referência para a operação por teclado é o [critério 2.1.1 das Diretrizes de Acessibilidade para Conteúdo Web, versão 2.2](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html).

## Como os arquivos estão organizados

| Arquivo ou pasta | Conteúdo |
| --- | --- |
| `haskell/Main.hs` | Agente que escolhe as ações e atualiza a tabela Q |
| `src` | Modelos dos fluxos, controle do navegador, regras do oráculo e geração de relatórios |
| `test` | Testes dos modelos e do funcionamento do código |
| `scripts/verificar_artigo.py` | Verificação dos resultados a partir dos registros usados no artigo |
| `package.json` e `package-lock.json` | Comandos e dependências do projeto |
| `config.json` e `configuracoes_coleta` | Configuração atual e cópias das configurações usadas na coleta |
| `validacao_real` | Registros dos nove episódios de Q-learning, casos de teste e reaplicações |
| `documentacao` | Capturas de tela, painéis de diagnóstico e informações sobre a origem das imagens |

## Conferir os resultados da coleta

O arquivo [validacao_real/relatorio.html](validacao_real/relatorio.html) pode ser aberto no navegador para consultar os resultados e as sequências de teclas. O relatório e as tabelas de resumo foram gerados a partir dos registros de Q-learning. Os dados originais de cada episódio foram preservados.

Também é possível conferir as trajetórias, as teclas, as recompensas, a cobertura e as 140 atualizações da tabela Q com Python 3.10 ou superior. Essa verificação usa apenas a biblioteca padrão do Python e não precisa instalar nem executar o navegador de testes.

No Windows:

```powershell
py scripts/verificar_artigo.py
```

No Linux ou macOS:

```bash
python3 scripts/verificar_artigo.py
```

O comando salva a conferência em `resultados_verificados/verificacao.json` e a tabela de resultados em `resultados_verificados/tabela_artigo.csv`. Esses arquivos podem ser gerados novamente a qualquer momento e não precisam entrar no repositório.

## Preparar o ambiente e executar os testes

Para executar novos testes nas páginas, são necessários [Node.js](https://nodejs.org/) 22 ou superior e o [Glasgow Haskell Compiler (GHC)](https://www.haskell.org/ghcup/install/). No PowerShell, abra a pasta que contém `package.json` e execute:

```powershell
node --version
ghc --version
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run compilar
npm.cmd test
npm.cmd run doctor
```

A compilação também executa o autoteste do agente. Três testes dependem do programa Haskell compilado; sem ele, esses testes são ignorados. O resumo de `npm.cmd test` informa se isso aconteceu. No Linux ou macOS, os comandos usam `npm` e `npx` no lugar de `npm.cmd` e `npx.cmd`.

Cada fluxo tem uma configuração da coleta. O exemplo abaixo guarda a configuração atual, aplica a do IBGE, executa três episódios e restaura o arquivo anterior ao final:

```powershell
Copy-Item config.json config.original.json
Copy-Item configuracoes_coleta/ibge.json config.json
npm.cmd run piloto:ibge -- --episodios 3 --semente 20261015 --limite 2500
Copy-Item config.original.json config.json
```

Para testar outro fluxo, a configuração e o comando devem corresponder à mesma linha da tabela:

| Fluxo | Configuração | Comando |
| --- | --- | --- |
| Menu do gov.br | `configuracoes_coleta/menu.json` | `npm.cmd run piloto:menu` |
| Gráfico do IBGE | `configuracoes_coleta/ibge.json` | `npm.cmd run piloto:ibge` |
| Gráfico do Banco Mundial | `configuracoes_coleta/banco.json` | `npm.cmd run piloto:banco` |

Os arquivos da nova execução ficam em `resultados`, na pasta indicada pelo terminal. Os parâmetros usados na coleta foram α = 0,1, γ = 0,9 e ε = 0,2. Eles controlam, respectivamente, a atualização dos valores Q, o peso das recompensas futuras e a chance de explorar uma ação aleatória.

A primeira confirmação de uma transição em cada episódio vale 100 pontos, com desconto das teclas usadas na ação. Uma ação pode exigir várias teclas, incluindo as necessárias para chegar ao controle desejado. A tabela Q continua de um episódio para outro dentro do mesmo fluxo. Quando o episódio termina, o valor futuro usado na atualização é zero.

## Reaplicar os casos registrados

Os comandos abaixo reaplicam um caso do menu e os dois casos que registraram diferenças entre o comportamento esperado e o observado nos gráficos:

```powershell
npm.cmd run reproduzir -- --arquivo "validacao_real/menu-qlearning-20261015/suite.json" --caso 1
npm.cmd run reproduzir -- --arquivo "validacao_real/ibge-qlearning-20261015/caso_falha.json" --caso 1
npm.cmd run reproduzir -- --arquivo "validacao_real/banco-qlearning-20261015/caso_falha.json" --caso 1
```

A reaplicação usa as condições salvas no caso e confere o foco e os sinais relevantes da página antes de enviar cada tecla. O caso do menu tem 45 teclas. O do IBGE tem 19 entradas Tab, seguidas de Enter e Espaço, totalizando 21 teclas. O do Banco Mundial tem 27 entradas Tab. As verificações com mouse têm registros próprios e não entram na cobertura por teclado.

## Entender os registros e as imagens

Cada tipo de arquivo ajuda a acompanhar uma parte do teste:

| Arquivo | O que registra |
| --- | --- |
| `entradas.jsonl` | Teclas enviadas e observações da página |
| `transicoes.jsonl` | Ações, respostas, recompensas e atualizações da tabela Q |
| Arquivos de cada episódio | Cobertura alcançada e motivo do encerramento |
| `suite.json` | Casos de teste selecionados para cobrir as transições confirmadas |
| `caso_falha.json` e `vetor_ate_falha.json` | Caso e sequência de teclas que levaram à diferença observada |

Os registros das reaplicações feitas na coleta estão em `validacao_real/reproducoes`.

As capturas de `documentacao/telas` mostram os componentes das páginas em 23/11/2026. Os painéis de `documentacao/diagnosticos` foram montados com os registros de 11/11/2026. O arquivo `documentacao/evidencias.json` informa a origem e a data de cada imagem.

Para registrar rastreamentos do Playwright e capturas das ocorrências reconhecidas pelo executor, a opção `traces` de `config.json` deve estar como `true`. Novas execuções devem ser guardadas com suas datas e configurações, mantendo os registros do artigo como referência.

## O que pode mudar em uma nova execução

A coleta original utilizou teclas nativas em uma sessão do Chrome. O código local usa Playwright e abre um contexto novo por episódio. A área útil foi de 1348 × 936 pixels no menu e de 1363 × 936 pixels nos gráficos. As versões exatas do Chrome, do Node.js e do GHC da coleta não foram preservadas. Essas versões devem ser registradas nas próximas execuções.

A semente permite repetir as escolhas do agente, mas não controla o carregamento, os cookies, o conteúdo remoto ou as alterações nas páginas. Se a estrutura ou a ordem de foco mudar, a reaplicação pode ser interrompida. Conferir os arquivos da coleta permite verificar os resultados registrados; executar os testes nas páginas atuais produz uma nova coleta, que pode apresentar outros resultados.

Os metadados guardam hashes dos arquivos usados na coleta. Esses identificadores mudam mesmo quando a alteração é apenas em um comentário, como nesta revisão. Os comentários foram reescritos sem alterar as instruções executadas pelo programa. O fluxo do menu também reaproveita um piloto anterior, que já tinha diferenças em quatro arquivos da implementação. A conferência lista as diferenças em `verificacao.json`, e os metadados originais foram mantidos. Por isso, os registros permitem conferir as trajetórias e os resultados, mas não reconstruir exatamente todo o ambiente da coleta.
