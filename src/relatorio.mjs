import fs from 'node:fs/promises';
import path from 'node:path';
const escape = x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(headers,rows)=>`<table><thead><tr>${headers.map(x=>`<th>${escape(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const csv=rows=>'\ufeff'+rows.map(r=>r.map(v=>'"'+(typeof v==='number'?v.toLocaleString('pt-BR',{useGrouping:false,maximumFractionDigits:8}):String(v??'')).replaceAll('"','""')+'"').join(';')).join('\r\n');
const localDate=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'});
export async function relatorio(results,root) {
  const rows=results.map(r=>[r.metadata.model.nome,r.metadata.mode,r.metadata.seed,r.metadata.model.estados.length,r.metadata.model.transicoes.length,
    `${r.completedEpisodes}/${r.plannedEpisodes}`,r.metadata.config.limitePassos,r.episodes.reduce((n,e)=>n+e.passos,0),r.coverage,r.firstComplete??'nao ocorreu',r.issues.length]);
  const headers=['Fluxo','Estrategia','Semente','Estados','Transicoes','Episodios executados/previstos','Teto de teclas por episodio','Teclas consumidas','Cobertura acumulada %','Primeiro episodio completo','Ocorrencias distintas'];
  await fs.writeFile(path.join(root,'resumo.csv'),csv([headers,...rows]));
  const allEpisodes=[['fluxo','estrategia','semente','episodio','teclas_teste','teclas_preparo','cobertura_episodio','cobertura_acumulada','tentativas_pct','parada','segundos']];
  results.forEach(r=>r.episodes.forEach(e=>allEpisodes.push([r.metadata.model.id,r.metadata.mode,r.metadata.seed,e.number,e.passos,e.preparo,e.coverage,e.cumulative,e.attemptCoverage,e.stop,e.elapsedSeconds])));
  await fs.writeFile(path.join(root,'episodios.csv'),csv(allEpisodes));
  const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Testes de acessibilidade em sites reais</title>
  <style>body{font:16px/1.5 system-ui,sans-serif;max-width:1180px;margin:40px auto;padding:0 24px;color:#17324d;background:#fff}h1{font-size:30px}h2{margin-top:40px}table{border-collapse:collapse;width:100%;font-size:14px;margin:20px 0}th,td{border:1px solid #cbd5df;padding:9px;text-align:left}th{background:#edf2f7}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:16px;color:#17212b}a{color:#005ea8}small{color:#526476}.wide{overflow:auto}details{margin:16px 0}summary{cursor:pointer;font-weight:600}</style>
  <h1>Testes de acessibilidade em sites reais</h1><p>Gerado em ${escape(localDate.format(new Date()))} (Brasília). EFSM com saídas de Mealy. A cobertura funcional e os achados de acessibilidade são registrados em separado.</p>
  <p><strong>100% indica que todas as transições funcionais do recorte foram exercitadas com a saída prevista.</strong> Um controle pode funcionar e ainda apresentar uma barreira de acessibilidade.</p>
  <div class="wide">${table(headers,rows)}</div>
  ${results.map(r=>`<h2>${escape(r.metadata.model.nome)} · ${escape(r.metadata.mode)} · ${r.metadata.seed}</h2>
  <p><small>Ambiente: ${escape(r.metadata.executionNotes)}.</small></p>
  <p>α=${r.metadata.config.alpha}; γ=${r.metadata.config.gamma}; ε=${r.metadata.config.epsilon}. No controle aleatório, a seleção é uniforme e Q não é atualizado. No roteiro fixo, não há aprendizagem.</p>
  ${table(['Episódio','Teclas','Preparo','Cobertura do episódio %','Acumulada %','Parada'],r.episodes.map(e=>[e.number,e.passos,e.preparo,e.coverage,e.cumulative,e.stop]))}
  <p>Seleção de casos: ${escape(r.suite.selection)}. Primeiro episódio completo: ${r.firstComplete??'não ocorreu'}. Episódios escolhidos: ${r.suite.cases.map(c=>c.episode).join(', ')||'nenhum prefixo válido'}.</p>
  <p>Transições ainda não cobertas: ${escape(r.missing.map(t=>t.id).join(', ')||'nenhuma')}.</p>
  ${r.failure?`<p><strong>Falha funcional em ${escape(r.failure.transition)}:</strong> episódio ${r.failure.episode}, ${r.failure.keys} teclas até a falha. <a href="${escape(path.relative(root,r.dir).split(path.sep).join('/'))}/vetor_ate_falha.json">Abrir vetor até a falha</a> · <a href="${escape(path.relative(root,r.dir).split(path.sep).join('/'))}/caso_falha.json">Abrir caso de reprodução</a></p>`:''}
  ${r.issues.length?table(['ID','Situação','Motivo','Repetições'],r.issues.map(i=>[i.id,i.status,i.reason,i.occurrences])):'<p>Nenhuma ocorrência foi registrada pelas verificações executadas. Isso não certifica acessibilidade.</p>'}
  ${r.episodes.filter(e=>e.error).map(e=>`<p><strong>Erro no episódio ${e.number}:</strong> ${escape(e.error)}</p>`).join('')}
  ${r.suite.cases.map(c=>`<details><summary>Vetor de entrada do episódio ${c.episode}</summary><p>Inclui o preparo. Reinicie a página em contexto novo antes de cada caso.</p><pre>${escape(JSON.stringify(c.inputs.map(i=>i.key)))}</pre><p>Sequência de ações do modelo:</p><pre>${escape(JSON.stringify(c.steps.map(s=>s.action)))}</pre></details>`).join('')}
  <p><a href="${escape(path.relative(root,r.dir).split(path.sep).join('/'))}/suite.json">Abrir suite.json</a> · <a href="${escape(path.relative(root,r.dir).split(path.sep).join('/'))}/vetores_selecionados.json">Abrir vetores de entrada</a></p>`).join('')}
  <h2>Como interpretar</h2><p>Uma tecla ou combinação enviada conta como um passo físico; cada caractere digitado também conta. Uma ação do modelo pode consumir várias teclas. O preparo de cookies e a navegação inicial são registrados separadamente. “Tentada” indica acionamento do teste; “coberta” exige a pós-condição observada.</p>
  <p>“Falha reproduzida” vale para o controle e o ambiente observados. “Falha funcional” indica que uma ação produziu a resposta errada e a transição ficou sem cobertura. As transições dependentes podem ficar sem tentativa. “Suspeita” indica um sinal a investigar. “Inconclusivo” indica evidência insuficiente, limite de busca ou falha técnica.</p>
  <p>O melhor episódio é o mais curto entre os completos observados. Se nenhum for completo, a suíte combina prefixos reais de episódios, com reinicialização entre eles. Não é uma única sequência contínua.</p>
  <p>Arquivos: <a href="resumo.csv">resumo.csv</a> e <a href="episodios.csv">episodios.csv</a>.</p></html>`;
  await fs.writeFile(path.join(root,'relatorio.html'),html);
}
