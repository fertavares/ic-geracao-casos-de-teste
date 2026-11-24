import {ibge,banco,conferePortal,falhaPortal} from './portais.mjs';
const t=(id,from,action,to,expected)=>({id,from,action,to,expected});
export const modelos={
  menu: {
    id:'menu', nome:'Menu principal', url:'https://www.gov.br/pt-br', inicial:'pagina',
    estados:['pagina','acionador','primeiro_item','segundo_item'],
    transicoes:[
      t('M01','pagina','ALCANCAR_MENU','acionador','O acionador recebe foco por Tab.'),
      t('M02','acionador','ABRIR_MENU','primeiro_item','Menu visivel e primeiro link com foco.'),
      t('M03','primeiro_item','AVANCAR_ITEM','segundo_item','Tab move o foco para outro link visivel do menu.'),
      t('M04','segundo_item','RECUAR_ITEM','primeiro_item','Shift+Tab retorna ao primeiro link.'),
      t('M05','primeiro_item','ESCAPE','acionador','Menu fecha e o acionador recebe foco.'),
      t('M06','segundo_item','ESCAPE','acionador','Menu fecha e o acionador recebe foco.'),
      t('M07','primeiro_item','FECHAR_MENU','acionador','O acionador, alcançado por Shift+Tab, fecha o menu.'),
      t('M08','segundo_item','FECHAR_MENU','acionador','O acionador, alcançado por Shift+Tab, fecha o menu.')
    ],
    roteiro:['ALCANCAR_MENU','ABRIR_MENU','AVANCAR_ITEM','RECUAR_ITEM','ESCAPE','ABRIR_MENU','AVANCAR_ITEM','ESCAPE','ABRIR_MENU','FECHAR_MENU','ABRIR_MENU','AVANCAR_ITEM','FECHAR_MENU']
  },
  ibge,banco
};
export const habilitadas=(m,s)=>m.transicoes.filter(t=>t.from===s);
export function confereEstado(m,s,o){
  if(m.id!=='menu')return conferePortal(m,s,o);
  if(!o?.adapterOk)return false;
    if(s==='pagina') return !o.menuOpen;
    if(s==='acionador') return !o.menuOpen && o.focus.isMenuToggle;
    if(s==='primeiro_item') return o.menuOpen && o.focus.isFirstMenuLink && o.focus.visible;
    if(s==='segundo_item') return o.menuOpen && o.focus.inMenu && !o.focus.isFirstMenuLink && o.focus.visible;
  return false;
}
export function julgar(m,tr,before,after){
  if(!after?.adapterOk)return {status:'inconclusivo',reason:'Estrutura da página difere do adaptador.'};
  const falha=m.id==='menu'?null:falhaPortal(tr,after);
  if(falha)return {status:'falha_funcional',reason:falha};
  if(!confereEstado(m,tr.to,after))return {status:'suspeita',reason:'A saída observada difere da esperada.'};
  if(tr.id==='M03'&&before.focus?.signature===after.focus.signature)
    return {status:'suspeita',reason:'Tab não deslocou o foco.'};
  return {status:'atendido',reason:'Pós-condição observada.'};
}
export function verificarSemantica(m,tr,after) {
  if(m.id!=='menu')return null;
  if(!['ABRIR_MENU','ABRIR_FILTRO'].includes(tr.action))return null;
  const control=m.id==='menu'?after.menuControl:after.filterControl;
  if(!control||/\baria-expanded\s*=\s*"true"/i.test(control))return null;
  return {id:`${m.id}-estado-expandido`,status:'suspeita',
    reason:'Painel aberto sem aria-expanded="true" no acionador inspecionado.',
    expected:'O estado aberto deve estar disponivel programaticamente. Verificar a semantica e o anuncio no leitor de tela.',
    criterionCandidate:'Investigar WCAG 2.2, 4.1.2. Ausencia de um atributo isolado nao confirma violacao.',
    observed:control};
}
export function chaveEstado(m,s,obs,visited,remaining) {
  // A mesma página pode exigir outra decisão se a cobertura ou o saldo de teclas mudar.
  // Por isso, essas informações entram na chave da tabela Q.
  // O estado ainda é parcial e não garante a propriedade de Markov.
  const mask=m.transicoes.reduce((a,t,i)=>a+(visited.has(t.id)?2**i:0),0);
  const focus=obs.focus?.bucket??'desconhecido';
  return `${m.id}:${s}:${focus}:v${mask}:r${remaining}`;
}
export function assinaturaReproducao(o){
  return JSON.stringify({path:o.url?new URL(o.url).pathname:null,menuOpen:o.menuOpen,filterOpen:o.filterOpen,query:o.query,
    focus:o.focus?.signature,results:o.results,ibge:o.ibge&&[o.ibge.fontesAbertas,o.ibge.valor2010],
    banco:o.banco&&[o.banco.view,o.banco.barChart]});
}
