import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {modelos,habilitadas,julgar,chaveEstado,verificarSemantica} from '../src/modelos.mjs';
import {selecionarCasos,percent} from '../src/experimento.mjs';
import {Executor} from '../src/navegador.mjs';
import {Aprendiz,executable} from '../src/aprendiz.mjs';
import {validarConfig} from '../src/cli.mjs';

test('cada roteiro de referencia percorre todos os alvos declarados',()=>{
  for(const m of Object.values(modelos)){
    let s=m.inicial;const covered=new Set();
    for(const a of m.roteiro){const t=habilitadas(m,s).find(t=>t.action===a);assert.ok(t,`${m.id}/${s}/${a}`);covered.add(t.id);s=t.to;}
    assert.equal(covered.size,m.transicoes.length);
    assert.equal(new Set(m.transicoes.map(t=>t.id)).size,m.transicoes.length);
  }
});
test('uma falha de foco nao ganha cobertura de abertura do menu',()=>{
  const tr=modelos.menu.transicoes.find(t=>t.id==='M02');
  const after={adapterOk:true,menuOpen:true,focus:{isFirstMenuLink:false,visible:true}};
  assert.equal(julgar(modelos.menu,tr,{},after).status,'suspeita');
  assert.equal(modelos.menu.transicoes.length,8);
});
test('ausencia de seletor fica inconclusiva, sem alegar falha do site',()=>{
  assert.equal(julgar(modelos.menu,modelos.menu.transicoes[0],{},{adapterOk:false}).status,'inconclusivo');
});
test('sinal semantico nao elimina cobertura funcional nem confirma falha',()=>{
  const m=modelos.menu,tr=m.transicoes.find(t=>t.id==='M02');
  const after={adapterOk:true,menuOpen:true,focus:{isFirstMenuLink:true,visible:true},menuControl:'<a href="#">Abrir menu</a>'};
  assert.equal(julgar(m,tr,{},after).status,'atendido');
  assert.equal(verificarSemantica(m,tr,after).status,'suspeita');
  assert.equal(verificarSemantica(m,tr,{...after,menuControl:'<button aria-expanded="true">Menu</button>'}),null);
});
test('IBGE só conta I08 quando o valor fica disponível',()=>{
  const m=modelos.ibge,t=m.transicoes.find(x=>x.id==='I08');
  const o={adapterOk:true,focus:{bucket:'ano2010'},ibge:{valor2010:'',fontesAbertas:false}};
  assert.equal(julgar(m,t,o,o).status,'falha_funcional');
  assert.equal(julgar(m,t,o,{...o,ibge:{...o.ibge,valor2010:'2010: 98,20 %'}}).status,'atendido');
  assert.equal(julgar(m,t,o,{...o,adapterOk:false}).status,'inconclusivo');
});
test('Banco Mundial distingue falha de alcance e transição dependente',()=>{
  const m=modelos.banco,t=m.transicoes.find(x=>x.id==='B08');
  const o={adapterOk:true,focus:{bucket:'also'},banco:{view:'Line',barVisible:true,noTabControls:true}};
  assert.equal(julgar(m,t,{},o).status,'falha_funcional');
  assert.equal(julgar(m,t,{},{...o,focus:{bucket:'bar_foco'}}).status,'atendido');
  assert.equal(habilitadas(m,'licenca').some(x=>x.id==='B09'),false);
});
test('historico de cobertura e orçamento alteram a chave de Q',()=>{
  const m=modelos.menu,o={focus:{bucket:'outside'}};
  const a=chaveEstado(m,'pagina',o,new Set(),100);
  assert.notEqual(a,chaveEstado(m,'pagina',o,new Set(['M01']),100));
  assert.notEqual(a,chaveEstado(m,'pagina',o,new Set(),99));
});
const ep=(number,covered,passos)=>({number,covered,passos,prepInputs:1,initial:{},inputs:[{key:'setup'},{key:'a'},{key:'b'},{key:'c'},{key:'d'}],
  steps:covered.map((t,i)=>({transition:t,status:'atendido',inputEnd:i+2,after:{i}}))});
test('seleciona o completo mais curto e conserva o preparo',()=>{
  const m={transicoes:[{id:'a'},{id:'b'}]};
  const r=selecionarCasos([ep(1,['a','b'],9),ep(2,['a','b'],7)],m);
  assert.equal(r.cases[0].episode,2);assert.equal(r.cases[0].inputs[0].key,'setup');
});
test('suite incompleta preserva prefixos e nao soma episodios como percurso unico',()=>{
  const m={transicoes:[{id:'a'},{id:'b'},{id:'c'}]};
  const e1=ep(1,['a'],1),e2=ep(2,['a','b','b'],3);e2.covered=['a','b'];
  const r=selecionarCasos([e1,e2],m);
  assert.equal(r.cases.length,2);assert.equal(r.cases[1].steps.length,2);
  assert.deepEqual(r.cases[1].inputs.map(i=>i.key),['setup','a','b']);
  assert.deepEqual(r.cases[1].covered,['a','b']);
});
test('teto interrompe antes de enviar a proxima tecla',async()=>{
  let called=0;const ex=new Executor({keyboard:{press:async()=>called++}},modelos.menu,{limitePassos:1},'.');
  ex.phase='teste';ex.passos=1;
  await assert.rejects(()=>ex.tecla('Tab'),/limite_passos/);assert.equal(called,0);
});
test('busca de foco esgotada fica inconclusiva e conta todas as teclas',async()=>{
  let count=0;
  const page={locator:()=>({count:async()=>1,isVisible:async()=>true}),evaluate:async()=>false};
  const ex=new Executor(page,modelos.menu,{maxTabsPorBusca:3},'.');ex.tecla=async()=>count++;
  await assert.rejects(()=>ex.buscar('a'),e=>e.status==='inconclusivo');assert.equal(count,3);
});
test('navegacao que destrói o DOM apos Enter nao apaga a entrada enviada',async()=>{
  let calls=0;
  const page={keyboard:{press:async()=>{}},evaluate:async()=>{if(calls++===0)return {focus:{}};throw new Error('context destroyed');}};
  const ex=new Executor(page,modelos.menu,{limitePassos:5,pausaTeclaMs:0},'.');ex.phase='teste';
  await ex.tecla('Enter');assert.equal(ex.inputs[0].executed,true);assert.equal(ex.passos,1);assert.equal(ex.inputs[0].after,null);
});
test('parametros invalidos sao rejeitados',async()=>{
  const c=JSON.parse(await fs.readFile(new URL('../config.json',import.meta.url),'utf8'));
  validarConfig(c);assert.throws(()=>validarConfig({...c,limitePassos:0}));assert.throws(()=>validarConfig({...c,epsilon:1.2}));
});
test('cobertura usa denominador fixo e zero continua zero',()=>{assert.equal(percent(7,8),87.5);assert.equal(percent(0,8),0);});
test('Haskell calcula Bellman e trata terminal corretamente',{skip:!existsSync(executable())},()=>{
  const r=spawnSync(executable(),['--self-test'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('mesma semente repete escolhas no processo Haskell real',{skip:!existsSync(executable())},async()=>{
  const seq=async seed=>{const l=new Aprendiz();try{await l.init({alpha:.1,gamma:.9,epsilon:.2},seed,'qlearning');const a=[];for(let i=0;i<30;i++)a.push((await l.choose('s',['a','b','c'])).action);return a;}finally{l.close();}};
  const a=await seq(20261015);assert.deepEqual(a,await seq(20261015));assert.notDeepEqual(a,await seq(20261016));
});
test('controle aleatorio nao aprende valores Q',{skip:!existsSync(executable())},async()=>{
  const l=new Aprendiz();try{await l.init({alpha:.1,gamma:.9,epsilon:.2},42,'aleatorio');const r=await l.learn('s','a',100,'t',['b'],false);assert.equal(r.new,0);}finally{l.close();}
});
