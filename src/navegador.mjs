import fs from 'node:fs/promises';
import path from 'node:path';
import {confereEstado,julgar} from './modelos.mjs';
import {pronto,observarPortal,falhaPortal,BANCO_URL} from './portais.mjs';

export const seletores = {
  menuToggle:'a.toggle-main-navigation', menu:'nav.navigation-wrapper',
  reject:'button.reject-all'
};
export class Interrupcao extends Error {
  constructor(reason,status='inconclusivo'){super(reason);this.status=status;}
}
export const pausa = ms => new Promise(r=>setTimeout(r,ms));

export async function observar(page,model) {
  if(model.id!=='menu')return observarPortal(page,model);
  return page.evaluate(sel=>{
    const visible=e=>{
      if(!e||!e.getClientRects().length)return false;
      for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||s.opacity==='0')return false;}
      return true;
    };
    const nav=document.querySelector(sel.menu);
    let el=document.activeElement;
    while(el?.shadowRoot?.activeElement) el=el.shadowRoot.activeElement;
    const name=el?.tagName==='BODY'?'':(el?.getAttribute('aria-label') || el?.getAttribute('title') || el?.getAttribute('placeholder') || el?.textContent || '').replace(/\s+/g,' ').trim().slice(0,180);
    const first=nav?.querySelector('#main-navigation > ul > li > a');
    const isMenuToggle=!!el?.matches(sel.menuToggle), inMenu=!!nav?.contains(el);
    const bucket=isMenuToggle?'menu_toggle':inMenu?(el===first?'menu_first':'menu_other'):'outside';
    const style=el?getComputedStyle(el):null;
    const b=el?.getBoundingClientRect();
    const aria=el?{role:el.getAttribute('role'),expanded:el.getAttribute('aria-expanded'),controls:el.getAttribute('aria-controls'),label:el.getAttribute('aria-label')}:{};
    return {
      url:location.href,title:document.title,time:new Date().toISOString(),
      adapterOk:document.querySelectorAll(sel.menuToggle).length===1 && !!first,
      menuOpen:visible(nav),filterOpen:false,query:'',results:[],
      focus:{tag:el?.tagName,id:el?.id??'',name,bucket,signature:JSON.stringify([el?.tagName,el?.id??'',name,el?.getAttribute('href')??'']),
        isMenuToggle,inMenu,isFirstMenuLink:el===first,visible:visible(el),aria,
        outline:style?{style:style.outlineStyle,width:style.outlineWidth,color:style.outlineColor,shadow:style.boxShadow}:null,
        rect:b?{x:b.x,y:b.y,width:b.width,height:b.height}:null},
      menuControl:document.querySelector(sel.menuToggle)?.outerHTML??null
    };
  },seletores);
}

export class Executor {
  constructor(page,model,config,dir,onInput=()=>{}) {
    Object.assign(this,{page,model,config,dir,onInput});
    this.inputs=[];this.phase='setup';this.passos=0;this.preparo=0;
  }
  async obs(){return observar(this.page,this.model);}
  async tecla(key,type='press') {
    if(this.phase==='teste' && this.passos>=this.config.limitePassos) throw new Interrupcao('limite_passos');
    const before=await this.obs();
    const row={index:this.inputs.length+1,phase:this.phase,type,key,before};
    // A tecla fica registrada antes do envio, mesmo se o navegador falhar.
    this.inputs.push(row);
    if(this.phase==='teste')this.passos++;else this.preparo++;
    try {
      if(type==='type') await this.page.keyboard.type(key);
      else await this.page.keyboard.press(key);
      row.executed=true;
      const esperaValor=this.model.id==='ibge'&&before.focus.bucket==='ano2010'&&['Enter','Space'].includes(key);
      await pausa(esperaValor?Math.max(this.config.pausaTeclaMs,650):this.config.pausaTeclaMs);
      try{row.after=await this.obs();}catch(e){row.after=null;row.observationError=e.message;}
    } catch(e) {row.executed=false;row.error=e.message;throw e;}
    finally {await this.onInput(row);}
  }
  async temFoco(selector) {
    return this.page.evaluate(sel=>{let e=document.activeElement;while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;return !!e?.matches(sel);},selector);
  }
  async buscar(selector,direction='Tab') {
    const loc=this.page.locator(selector);
    if(await loc.count()!==1 || !await loc.isVisible()) throw new Interrupcao(`Controle ausente, ambiguo ou oculto: ${selector}`);
    for(let n=0;n<=this.config.maxTabsPorBusca;n++) {
      if(await this.temFoco(selector))return;
      if(n===this.config.maxTabsPorBusca) break;
      await this.tecla(direction);
    }
    // Chegar ao limite de tentativas não basta para concluir que o foco ficou preso.
    throw new Interrupcao(`Controle nao alcancado em ${this.config.maxTabsPorBusca} teclas ${direction}; revisar trajeto.`);
  }
  async buscarFoco(bucket,direction='Tab'){
    for(let n=0;n<=this.config.maxTabsPorBusca;n++){
      const o=await this.obs();
      if(!o.adapterOk)throw new Interrupcao('Estrutura da página mudou durante a busca.');
      if(o.focus.bucket===bucket)return;
      if(n<this.config.maxTabsPorBusca)await this.tecla(direction);
    }
    throw new Interrupcao('Foco não alcançado dentro do limite de busca.');
  }
  async preparar() {
    await this.page.goto(this.model.url,{waitUntil:'domcontentloaded',timeout:this.config.timeoutMs*2});
    if(this.model.id!=='menu'){
      await this.page.locator(pronto[this.model.id]).first().waitFor({state:'visible',timeout:this.config.timeoutMs});
      const end=Date.now()+this.config.timeoutMs;
      while(Date.now()<end&&!(await this.obs()).adapterOk)await pausa(150);
    }else{
      await this.page.locator(seletores.menuToggle).waitFor({state:'visible',timeout:this.config.timeoutMs});
      await pausa(1200);
      if(await this.page.locator(seletores.reject).isVisible()){
        await this.buscar(seletores.reject);
        await this.tecla('Enter');
        await this.page.locator(seletores.reject).waitFor({state:'hidden',timeout:this.config.timeoutMs});
      }
    }
    const before=await this.obs();
    if(!confereEstado(this.model,this.model.inicial,before)) throw new Interrupcao('Estado inicial nao reconhecido; conferir se o site mudou.');
    await fs.writeFile(path.join(this.dir,'inicio.json'),JSON.stringify(before,null,2));
    this.phase='teste';return before;
  }
  async esperar(tr) {
    const end=Date.now()+this.config.timeoutMs;
    let after;
    do {
      try{
        after=await this.obs();
        if(confereEstado(this.model,tr.to,after)||(this.model.id!=='menu'&&falhaPortal(tr,after)))return after;
      }
      catch(e){if(this.page.isClosed())throw e;}
      await pausa(150);
    }while(Date.now()<end);
    if(!after)throw new Interrupcao('Nenhuma observacao valida apos a entrada.');
    return after;
  }
  async executar(tr,before) {
    if(!confereEstado(this.model,tr.from,before))return {status:'inconclusivo',reason:'Pre-condicao deixou de valer.',after:before,cost:0};
    const start=this.passos;
    try {
      switch(tr.action){
        case 'ALCANCAR_MENU':await this.buscar(seletores.menuToggle);break;
        case 'ABRIR_MENU':await this.tecla('Enter');break;
        case 'AVANCAR_ITEM':await this.tecla('Tab');break;
        case 'RECUAR_ITEM':await this.tecla('Shift+Tab');break;
        case 'ESCAPE':await this.tecla('Escape');break;
        case 'FECHAR_MENU':await this.buscar(seletores.menuToggle,'Shift+Tab');await this.tecla('Enter');break;
        case 'I_ALCANCAR':await this.buscarFoco('ano2010');break;
        case 'I_AVANCAR':case 'I_FONTES':case 'B_SHARE':case 'B_DETAILS':await this.tecla('Tab');break;
        case 'I_ABRIR':case 'I_FECHAR':case 'B_SELECIONAR_BAR':await this.tecla('Enter');break;
        case 'I_VOLTAR_2022':case 'I_VOLTAR_2010':case 'B_VOLTAR_SHARE':case 'B_VOLTAR_ALSO':
          await this.tecla('Shift+Tab');break;
        case 'I_CONSULTAR':
          if(before.ibge.valor2010)break;
          await this.tecla('Enter');
          if(!(await this.obs()).ibge.valor2010)await this.tecla('Space');
          break;
        case 'B_LICENCA':await this.buscarFoco('licenca');break;
        case 'B_ALSO':await this.buscarFoco('also');break;
        case 'B_VOLTAR_LICENCA':await this.buscarFoco('licenca','Shift+Tab');break;
        case 'B_ALCANCAR_BAR':
          // A busca procura Bar e para ao chegar a Also Show, que fica depois do seletor.
          for(let i=0;i<3;i++){
            await this.tecla('Tab');
            const o=await this.obs();
            if(['bar_foco','also'].includes(o.focus.bucket))break;
            if(o.focus.bucket==='line_foco'){
              await this.tecla('ArrowRight');
              if((await this.obs()).focus.bucket==='bar_foco')break;
            }
          }
          break;
        default:throw new Interrupcao('Acao desconhecida pelo adaptador.');
      }
      await pausa(this.config.pausaTransicaoMs);
      const after=await this.esperar(tr);
      const verdict=julgar(this.model,tr,before,after);
      return {...verdict,after,cost:this.passos-start};
    }catch(e){
      const after=await this.obs().catch(()=>null);
      return {status:e.status??'inconclusivo',reason:e.message,after,cost:this.passos-start};
    }
  }
}

export async function abrirContexto(browser,model,config) {
  const context=await browser.newContext({viewport:config.viewport,locale:model.id==='banco'?'en-US':'pt-BR',timezoneId:'America/Sao_Paulo',reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(config.timeoutMs);
  const origin=new URL(model.url);
  await page.route('**/*',async route=>{
    const request=route.request();
    if(request.isNavigationRequest() && request.frame()===page.mainFrame()){
      const url=new URL(request.url());
      const inScope=url.href===model.url||
        (model.id==='menu'&&url.origin===origin.origin&&url.pathname==='/pt-br/')||
        (model.id==='banco'&&url.origin===origin.origin&&url.pathname===new URL(BANCO_URL).pathname&&url.searchParams.get('view')==='bar');
      if(!inScope)return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.on('popup',p=>p.close().catch(()=>{}));
  if(config.traces)await context.tracing.start({screenshots:true,snapshots:true,sources:false});
  return {context,page};
}
