import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {modelos} from './modelos.mjs';
import {rodar,reproduzir,json} from './experimento.mjs';
import {relatorio} from './relatorio.mjs';
import {executable} from './aprendiz.mjs';

function argsOf(args){
  const parsed={};
  for(let i=0;i<args.length;i++){
    if(!args[i].startsWith('--'))throw new Error(`Argumento inesperado: ${args[i]}`);
    const key=args[i].slice(2);
    if(key==='headless')parsed.headless=true;
    else{if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Falta valor de --${key}`);parsed[key]=args[++i];}
  }
  const allowed=['modo','fluxo','episodios','limite','semente','headless','arquivo','caso','pasta'];
  for(const key of Object.keys(parsed))if(!allowed.includes(key))throw new Error(`Opcao desconhecida: --${key}`);
  return parsed;
}
export function validarConfig(c){
  for(const k of ['episodios','limitePassos','episodiosComparacao','maxTabsPorBusca','timeoutMs'])
    if(!Number.isSafeInteger(c[k])||c[k]<1)throw new Error(`config.json: ${k} precisa ser inteiro positivo.`);
  for(const k of ['alpha','gamma','epsilon'])if(!Number.isFinite(c[k])||c[k]<0||c[k]>1)throw new Error(`config.json: ${k} deve estar entre 0 e 1.`);
  if(!Number.isSafeInteger(c.semente)||!Array.isArray(c.sementesComparacao)||!c.sementesComparacao.length||c.sementesComparacao.some(x=>!Number.isSafeInteger(x)))throw new Error('Sementes devem ser inteiros.');
  if(new Set(c.sementesComparacao).size!==c.sementesComparacao.length)throw new Error('Sementes de comparacao devem ser distintas.');
  for(const k of ['pausaTeclaMs','pausaTransicaoMs','pausaEpisodioMs'])if(!Number.isFinite(c[k])||c[k]<0)throw new Error(`Valor invalido de ${k}.`);
}
const hashSource=async()=>createHash('sha256').update(await fs.readFile('haskell/Main.hs')).digest('hex');
async function compilar(){
  await fs.mkdir('bin',{recursive:true});await fs.mkdir('build',{recursive:true});
  const result=spawnSync(process.env.GHC||'ghc',['-O1','-outputdir','build','-o',executable(),'haskell/Main.hs'],{stdio:'inherit',windowsHide:true});
  if(result.error||result.status!==0)throw new Error('Compilacao indisponivel. Instale GHC pelo GHCup, reabra o PowerShell e teste ghc --version.');
  const check=spawnSync(executable(),['--self-test'],{stdio:'inherit',windowsHide:true});
  if(check.status!==0)throw new Error('O autoteste Haskell falhou.');
  await json('bin/compilacao.json',{sha256:await hashSource(),time:new Date().toISOString()});
}
async function checkCompiled(){
  const build=JSON.parse(await fs.readFile('bin/compilacao.json','utf8').catch(()=>'{"sha256":""}'));
  if(build.sha256!==await hashSource())throw new Error('Execute npm.cmd run compilar antes de iniciar. O binario deve corresponder ao fonte atual.');
}
async function doctor(){
  console.log(`Node: ${process.version}`);
  const ghc=spawnSync(process.env.GHC||'ghc',['--numeric-version'],{encoding:'utf8',windowsHide:true});
  console.log(ghc.status===0?`GHC: ${ghc.stdout.trim()}`:'GHC: ausente no PATH. Veja o roteiro de instalacao.');
  const {chromium}=await import('playwright');const browserPath=chromium.executablePath();
  try{await fs.access(browserPath);console.log('Chromium: instalado.');}catch{console.log('Chromium: ausente. Execute npx.cmd playwright install chromium.');}
  console.log('Este diagnóstico não executa testes nos sites.');
}
async function main(){
  const command=process.argv[2];const args=argsOf(process.argv.slice(3));
  if(command==='compilar')return compilar();
  if(command==='doctor')return doctor();
  if(command==='relatorio'){
    if(!args.pasta)throw new Error('Use --pasta resultados/EXECUCAO');
    const results=[];
    for(const name of await fs.readdir(args.pasta,{withFileTypes:true}))if(name.isDirectory()){
      try{const r=JSON.parse(await fs.readFile(path.join(args.pasta,name.name,'resultado.json'),'utf8'));r.dir=path.join(args.pasta,name.name);results.push(r);}catch{}
    }
    if(!results.length)throw new Error('Nenhum resultado de experimento encontrado nessa pasta.');
    return relatorio(results,args.pasta);
  }
  if(!['executar','comparar','reproduzir'].includes(command))throw new Error('Use os comandos npm do roteiro: validar, piloto, comparar ou reproduzir.');
  const config=JSON.parse(await fs.readFile('config.json','utf8'));
  if(args.episodios)config.episodios=Number(args.episodios);
  if(args.limite)config.limitePassos=Number(args.limite);
  if(args.semente)config.semente=Number(args.semente);
  if(args.headless)config.headless=true;
  validarConfig(config);
  const mode=args.modo??'qlearning';if(!['qlearning','aleatorio','roteiro'].includes(mode))throw new Error('Modo invalido.');
  const flows=args.fluxo&&args.fluxo!=='todos'?[modelos[args.fluxo]]:Object.values(modelos);
  if(flows.some(m=>!m))throw new Error('Fluxo deve ser menu, ibge, banco ou todos.');
  if(command!=='reproduzir'&&(mode!=='roteiro'||command==='comparar'))await checkCompiled();
  const root=path.resolve('resultados',new Date().toISOString().replace(/[:.]/g,'-'));
  await fs.mkdir(root,{recursive:true});
  console.log(`Arquivos desta execucao: ${root}`);
  const {chromium}=await import('playwright');let browser;
  try{browser=await chromium.launch({headless:config.headless});}
  catch(e){await json(path.join(root,'erro_inicializacao.json'),{message:e.message,date:new Date().toISOString()});throw new Error('O navegador nao iniciou. Rode npx.cmd playwright install chromium e consulte erro_inicializacao.json. Nenhum resultado de cobertura foi produzido.');}
  browser.runtimeNodeVersion=process.version;
  const results=[];
  try{
    if(command==='reproduzir'){
      if(!args.arquivo)throw new Error('Use --arquivo "caminho/suite.json" --caso 1');
      const r=await reproduzir(browser,args.arquivo,root,Number(args.caso??1));
      if(r.status!=='concluida')process.exitCode=2;return;
    }
    if(command==='comparar'){
      config.episodios=args.episodios?Number(args.episodios):config.episodiosComparacao;
      const seeds=args.semente?[Number(args.semente)]:config.sementesComparacao;
      for(const [i,seed] of seeds.entries())for(const model of flows){
        const modes=i%2?['aleatorio','qlearning']:['qlearning','aleatorio'];
        for(const method of modes){results.push(await rodar(browser,model,config,method,seed,root));await relatorio(results,root);}
      }
    }else for(const model of flows){results.push(await rodar(browser,model,config,mode,config.semente,root));await relatorio(results,root);}
    console.log(`Abra no navegador: ${path.join(root,'relatorio.html')}`);
  }finally{await browser.close();}
}
// A chamada direta inicia o programa. A importação pelos testes apenas carrega as funções.
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error(`\nERRO: ${e.message}`);process.exitCode=1;});
