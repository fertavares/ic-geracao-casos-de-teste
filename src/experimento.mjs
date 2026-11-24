import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {Aprendiz} from './aprendiz.mjs';
import {habilitadas,chaveEstado,assinaturaReproducao,verificarSemantica,julgar} from './modelos.mjs';
import {Executor,abrirContexto,pausa} from './navegador.mjs';
import {IBGE_URL,BANCO_URL} from './portais.mjs';

export const json = (file,value)=>fs.writeFile(file,JSON.stringify(value,null,2),'utf8');
export const percent = (n,d)=>d?Number((100*n/d).toFixed(2)):0;
export async function identidade(config,browser) {
  const hashes={};
  for(const f of ['config.json','package-lock.json','haskell/Main.hs','src/modelos.mjs','src/navegador.mjs','src/experimento.mjs','src/portais.mjs'])
    hashes[f]=createHash('sha256').update(await fs.readFile(new URL('../'+f,import.meta.url))).digest('hex');
  return {created:new Date().toISOString(),node:browser.runtimeNodeVersion??null,os:`${os.platform()} ${os.release()} ${os.arch()}`,browser:browser.version(),executionNotes:browser.executionNotes??'Playwright local com contexto isolado por episodio',config,hashes,modelVersion:'ic-sites-0.4.0',criterion:'all-transitions do modelo declarado',machine:'EFSM com saidas de Mealy'};
}

export function selecionarCasos(episodes,model) {
  const good=episodes.filter(ep=>ep.covered.length===model.transicoes.length);
  const make=(ep,stepCount)=>{
    const steps=ep.steps.slice(0,stepCount);
    const inputCount=steps.at(-1)?.inputEnd??ep.prepInputs;
    return {episode:ep.number,steps,inputs:ep.inputs.slice(0,inputCount),expectedEnd:steps.at(-1)?.after??ep.initial,
      covered:[...new Set(steps.filter(s=>s.status==='atendido').map(s=>s.transition))]};
  };
  if(good.length){
    const best=[...good].sort((a,b)=>a.passos-b.passos||a.number-b.number)[0];
    return {selection:'menor episodio completo observado; sem garantia de minimo',cases:[make(best,best.steps.length)]};
  }
  const accumulated=new Set(),cases=[];
  for(const ep of episodes){
    let last=-1;
    ep.steps.forEach((s,i)=>{if(s.status==='atendido'&&!accumulated.has(s.transition)){accumulated.add(s.transition);last=i;}});
    if(last>=0)cases.push(make(ep,last+1));
  }
  return {selection:'suite de prefixos reais com contribuicao nova; reiniciar pagina entre casos',cases};
}

function selecionarFalha(episodes){
  const failures=episodes.flatMap(e=>e.steps.flatMap((s,i)=>s.status==='falha_funcional'?[{e,s,i}]:[]));
  const best=failures.sort((a,b)=>a.s.totalInputs-b.s.totalInputs||a.e.number-b.e.number)[0];
  if(!best)return null;
  const {e,s,i}=best;
  return {episode:e.number,steps:e.steps.slice(0,i+1),inputs:e.inputs.slice(0,s.inputEnd),expectedEnd:s.after,
    covered:[...new Set(e.steps.slice(0,i).filter(t=>t.status==='atendido').map(t=>t.transition))]};
}

// O progresso pode ser acompanhado durante a execução, sem reiniciar o agente.
export async function* acompanhar(browser,model,config,mode,seed,root,runtime={}) {
  const dir=path.join(root,`${model.id}-${mode}-${seed}`);await fs.mkdir(dir,{recursive:true});
  const metadata={...await identidade(config,browser),model,mode,seed};await json(path.join(dir,'metadados.json'),metadata);
  const learner=mode==='roteiro'?null:(runtime.createLearner?runtime.createLearner():new Aprendiz());
  const episodes=[],accumulated=new Set(),attemptedTotal=new Set(),issues=[];
  const total=mode==='roteiro'?1:config.episodios;
  try{
    if(learner)await learner.init(config,seed,mode);
    for(let n=1;n<=total;n++){
      const epdir=path.join(dir,`episodio-${String(n).padStart(3,'0')}`);await fs.mkdir(epdir,{recursive:true});
      const {context,page}=await abrirContexto(browser,model,config);
      const ExecutorClass=runtime.Executor??Executor;
      const ex=new ExecutorClass(page,model,config,epdir,row=>fs.appendFile(path.join(epdir,'entradas.jsonl'),JSON.stringify(row)+'\n'));
      const ep={number:n,initial:null,steps:[],covered:[],attempted:[],inputs:[],stop:'',passos:0,preparo:0,prepInputs:0};
      const visited=new Set(),attempted=new Set();let state=model.inicial,obs;
      const start=Date.now();
      try{
        obs=await ex.preparar();ep.initial=obs;ep.prepInputs=ex.inputs.length;
        while(ex.passos<config.limitePassos){
          const options=habilitadas(model,state);
          if(!options.length){ep.stop='sem_acoes_no_modelo';break;}
          if(visited.size===model.transicoes.length){ep.stop='cobertura_completa_no_episodio';break;}
          if(mode==='roteiro' && ep.steps.length>=model.roteiro.length){ep.stop='fim_do_roteiro';break;}
          const key=chaveEstado(model,state,obs,visited,config.limitePassos-ex.passos);
          const choice=learner?await learner.choose(key,options.map(t=>t.action)):{action:model.roteiro[ep.steps.length],mode:'roteiro_fixo'};
          const tr=options.find(t=>t.action===choice.action);
          if(!tr)throw new Error(`Roteiro/modelo incompativeis: ${state}/${choice.action}`);
          const before=obs;const outcome=await ex.executar(tr,before);
          attempted.add(tr.id);attemptedTotal.add(tr.id);
          const fresh=outcome.status==='atendido'&&!visited.has(tr.id);
          if(outcome.status==='atendido'){visited.add(tr.id);accumulated.add(tr.id);}
          // As teclas usadas para buscar o foco também entram no custo da ação.
          const reward=(fresh?100:0)-outcome.cost;
          const terminal=outcome.status!=='atendido'||ex.passos>=config.limitePassos||visited.size===model.transicoes.length;
          const next=outcome.status==='atendido'?tr.to:state;
          let update=null;
          if(learner && outcome.status!=='inconclusivo'){
            const nextKey=chaveEstado(model,next,outcome.after,visited,config.limitePassos-ex.passos);
            update=await learner.learn(key,tr.action,reward,nextKey,habilitadas(model,next).map(t=>t.action),terminal);
          }
          const step={number:ep.steps.length+1,transition:tr.id,from:state,action:tr.action,to:next,expected:tr.expected,
            choice,reward,update,fresh,before,...outcome,inputEnd:ex.inputs.length,totalInputs:ex.passos};
          ep.steps.push(step);await fs.appendFile(path.join(epdir,'transicoes.jsonl'),JSON.stringify(step)+'\n');
          if(outcome.status==='atendido'){
            const semantic=verificarSemantica(model,tr,outcome.after);
            if(semantic){
              const finding={...semantic,episode:n,step:step.number,transition:tr.id,confirmed:semantic.confirmed??false,inputs:ex.inputs.slice()};
              const first=!issues.some(i=>i.id===finding.id);
              issues.push(finding);
              if(first){
                await json(path.join(epdir,'achado_semantico.json'),finding);
                if(config.traces)await page.screenshot({path:path.join(epdir,'achado_semantico.png'),fullPage:false}).catch(()=>{});
              }
            }
          }
          if(outcome.status!=='atendido'){
            ep.stop=outcome.reason==='limite_passos'?'limite_passos':outcome.status;
            if(ep.stop!=='limite_passos'){
              const finding={id:`${model.id}-${tr.id}-${outcome.status}`,episode:n,step:step.number,transition:tr.id,status:outcome.status,reason:outcome.reason,
                expected:tr.expected,observed:outcome.after,inputs:ex.inputs,confirmed:outcome.status==='falha_funcional',
                criterionCandidate:outcome.status==='falha_funcional'?'WCAG 2.2, 2.1.1 (Teclado), na rota testada.':
                  tr.action==='ESCAPE'?'Hipotese do modelo; Escape isolado nao decide WCAG 2.1.2.':'Investigar operabilidade por teclado WCAG 2.1.1 e ordem do foco WCAG 2.4.3.'};
              issues.push(finding);await json(path.join(epdir,'ocorrencia.json'),finding);
              if(config.traces)await page.screenshot({path:path.join(epdir,'ocorrencia.png'),fullPage:false}).catch(()=>{});
            }
            break;
          }
          state=next;obs=outcome.after;
          if(runtime.yieldEvery && ep.steps.length%runtime.yieldEvery===0)
            yield {number:n,passos:ex.passos,coverage:percent(visited.size,model.transicoes.length),last:tr.id};
        }
        ep.stop||=visited.size===model.transicoes.length?'cobertura_completa_no_episodio':'limite_passos';
      }catch(e){
        ep.stop='erro_de_preparo_ou_execucao';ep.error=e.message;
        await json(path.join(epdir,'erro.json'),{message:e.message,stack:e.stack});
      }finally{
        Object.assign(ep,{covered:[...visited],attempted:[...attempted],inputs:ex.inputs,passos:ex.passos,preparo:ex.preparo,
          elapsedSeconds:Number(((Date.now()-start)/1000).toFixed(2)),coverage:percent(visited.size,model.transicoes.length),
          cumulative:percent(accumulated.size,model.transicoes.length),attemptCoverage:percent(attempted.size,model.transicoes.length)});
        await json(path.join(epdir,'episodio.json'),ep);
        await json(path.join(epdir,'vetor_entradas.json'),ex.inputs.map(x=>x.key));
        if(config.traces)await context.tracing.stop({path:path.join(epdir,'trace.zip')}).catch(()=>{});
        await context.close();episodes.push(ep);
      }
      console.log(`${model.id} | ${mode} | episodio ${n}/${total} | teclas ${ep.passos}/${config.limitePassos} (+${ep.preparo} preparo) | cobertura ${ep.coverage}% | acumulada ${ep.cumulative}% | ${ep.stop}`);
      // Um erro ou um resultado inconclusivo encerra a sequência de episódios.
      if(['erro_de_preparo_ou_execucao','inconclusivo'].includes(ep.stop))break;
      await pausa(config.pausaEpisodioMs);
    }
  }finally{learner?.close();}
  const suite={metadata,...selecionarCasos(episodes,model)};
  await json(path.join(dir,'suite.json'),suite);
  await json(path.join(dir,'vetores_selecionados.json'),suite.cases.map(c=>({episode:c.episode,preparo:c.inputs.filter(i=>i.phase==='setup').map(i=>i.key),entradas:c.inputs.filter(i=>i.phase==='teste').map(i=>i.key),vetorCompleto:c.inputs.map(i=>i.key)})));
  const failed=selecionarFalha(episodes);
  const failure=failed?{transition:failed.steps.at(-1).transition,episode:failed.episode,keys:failed.inputs.filter(i=>i.phase==='teste').length}:null;
  if(failed){
    await json(path.join(dir,'caso_falha.json'),{metadata,objetivo:'reproduzir_falha_funcional',cases:[failed]});
    await json(path.join(dir,'vetor_ate_falha.json'),failed.inputs.filter(i=>i.phase==='teste').map(i=>i.key));
  }
  const dedup=[...new Map(issues.map(i=>[i.id,{id:i.id,status:i.status,transition:i.transition,reason:i.reason,confirmed:i.confirmed??false,occurrences:issues.filter(x=>x.id===i.id).length}])).values()];
  const result={dir,metadata,episodes,covered:[...accumulated],attempted:[...attemptedTotal],issues:dedup,failure,
    missing:model.transicoes.filter(t=>!accumulated.has(t.id)),suite,coverage:percent(accumulated.size,model.transicoes.length),
    firstComplete:episodes.find(e=>e.coverage===100)?.number??null,completedEpisodes:episodes.length,plannedEpisodes:total};
  await json(path.join(dir,'resultado.json'),result);
  return result;
}

export async function rodar(...args) {
  const iterator=acompanhar(...args);
  for(;;){const next=await iterator.next();if(next.done)return next.value;}
}

export async function reproduzir(browser,suiteFile,root,caseNumber=1) {
  const suite=JSON.parse(await fs.readFile(suiteFile,'utf8'));
  const item=suite.cases[caseNumber-1];if(!item)throw new Error('Caso inexistente na suite.');
  const {model,config}=suite.metadata;
  if(!['https://www.gov.br/pt-br',IBGE_URL,BANCO_URL].includes(model.url))throw new Error('URL fora do escopo do piloto.');
  const {context,page}=await abrirContexto(browser,model,config);
  const dir=path.join(root,'reproducao');await fs.mkdir(dir,{recursive:true});
  const ex=new Executor(page,model,config,dir);
  let result={status:'concluida',case:caseNumber,steps:0};
  try{
    await ex.preparar();result.preparationKeys=ex.preparo;
    for(const input of item.inputs.filter(i=>i.phase==='teste')){
      if(!input.executed)throw new Error('Caso contem entrada cuja execucao original falhou.');
      const target=assinaturaReproducao(input.before);const end=Date.now()+config.timeoutMs;
      let observed;
      do{observed=await ex.obs();if(assinaturaReproducao(observed)===target)break;await pausa(150);}while(Date.now()<end);
      if(assinaturaReproducao(observed)!==target)throw new Error(`Foco/estado divergiu antes da entrada ${result.steps+1}. Nao foram puladas teclas.`);
      ex.phase=input.phase;await ex.tecla(input.key,input.type);result.steps++;

    }
    const target=assinaturaReproducao(item.expectedEnd);const end=Date.now()+config.timeoutMs;
    let last;
    do{last=await ex.obs();if(assinaturaReproducao(last)===target)break;await pausa(150);}while(Date.now()<end);
    if(assinaturaReproducao(last)!==target)throw new Error('Estado final divergiu do caso registrado.');
    if(suite.objetivo==='reproduzir_falha_funcional'){
      const expected=item.steps.at(-1),tr=model.transicoes.find(t=>t.id===expected?.transition);
      if(!tr||expected.status!=='falha_funcional'||julgar(model,tr,expected.before,last).status!=='falha_funcional')
        throw new Error('A falha funcional original não foi reproduzida.');
      result.falhaFuncional={reproduzida:true,transition:tr.id,expected:tr.expected,observed:last};
    }
  }catch(e){result={...result,status:'interrompida',reason:e.message};}
  finally{
    await json(path.join(dir,'resultado.json'),result);await json(path.join(dir,'entradas.json'),ex.inputs);
    if(config.traces)await context.tracing.stop({path:path.join(dir,'trace.zip')}).catch(()=>{});
    await context.close();
  }
  console.log(result);return result;
}
