export const IBGE_URL='https://www.ibge.gov.br/cidades-e-estados/sp/santos.html';
export const BANCO_URL='https://data.worldbank.org/indicator/SP.POP.TOTL';
export const pronto={ibge:'main svg g[focusable="true"]:has(circle)',banco:'#mainChart #ContextualDropdown'};
const m=(id,nome,url,estados,rows,roteiro)=>({
  id,nome,url,inicial:'pagina',estados,
  transicoes:rows.map(([id,from,action,to,expected])=>({id,from,action,to,expected})),
  roteiro
});
export const ibge=m('ibge','IBGE: gráfico de escolarização',IBGE_URL,
  ['pagina','ano2010','ano2022','fontes','fontes_abertas','valor2010'],[
  ['I01','pagina','I_ALCANCAR','ano2010','Tab alcança o ponto de 2010.'],
  ['I02','ano2010','I_AVANCAR','ano2022','Tab leva o foco ao ponto de 2022.'],
  ['I03','ano2022','I_FONTES','fontes','Tab leva o foco a Notas e fontes.'],
  ['I04','fontes','I_ABRIR','fontes_abertas','Enter abre o painel de notas e fontes.'],
  ['I05','fontes_abertas','I_FECHAR','fontes','Enter fecha o painel de notas e fontes.'],
  ['I06','fontes','I_VOLTAR_2022','ano2022','Shift+Tab volta ao ponto de 2022.'],
  ['I07','ano2022','I_VOLTAR_2010','ano2010','Shift+Tab volta ao ponto de 2010.'],
  ['I08','ano2010','I_CONSULTAR','valor2010','O valor de 2010 fica disponível pelo teclado.']
],['I_ALCANCAR','I_AVANCAR','I_FONTES','I_ABRIR','I_FECHAR','I_VOLTAR_2022','I_VOLTAR_2010','I_CONSULTAR']);
export const banco=m('banco','Banco Mundial: população total',BANCO_URL,
  ['pagina','licenca','also','share','details','bar_foco','barras'],[
  ['B01','pagina','B_LICENCA','licenca','Tab alcança o link da licença do gráfico.'],
  ['B02','licenca','B_ALSO','also','Tab alcança Also Show.'],
  ['B03','also','B_SHARE','share','Tab leva o foco a Share.'],
  ['B04','share','B_DETAILS','details','Tab leva o foco a Details.'],
  ['B05','details','B_VOLTAR_SHARE','share','Shift+Tab volta a Share.'],
  ['B06','share','B_VOLTAR_ALSO','also','Shift+Tab volta a Also Show.'],
  ['B07','also','B_VOLTAR_LICENCA','licenca','Shift+Tab volta à licença.'],
  ['B08','licenca','B_ALCANCAR_BAR','bar_foco','O foco chega a Bar antes de sair do seletor de visualização.'],
  ['B09','bar_foco','B_SELECIONAR_BAR','barras','Enter em Bar renderiza o gráfico de barras.']
],['B_LICENCA','B_ALSO','B_SHARE','B_DETAILS','B_VOLTAR_SHARE','B_VOLTAR_ALSO','B_VOLTAR_LICENCA','B_ALCANCAR_BAR','B_SELECIONAR_BAR']);

export async function observarPortal(page,model){
  return page.evaluate(({id,url,pontos})=>{
    const vis=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility==='visible';
    const f=document.activeElement;
    const txt=e=>e?.tagName==='BODY'?'':(e?.getAttribute('aria-label')||e?.textContent||'').replace(/\s+/g,' ').trim().slice(0,90);
    let x={};
    let adapterOk=false,bucket='outside';
    if(id==='ibge'){
      const main=document.querySelector('main'),points=[...document.querySelectorAll(pontos)].filter(vis);
      const notes=[...main?.querySelectorAll('button')??[]].find(e=>txt(e)==='Notas e fontes');
      const panel=main?.querySelector('.fontes-container');
      const label=points[0]?.getAttribute('aria-label')??points[0]?.querySelector('title')?.textContent??'';
      const tooltip=[...main?.querySelectorAll('svg [role="tooltip"]')??[]].find(e=>vis(e)&&
        Number(getComputedStyle(e).opacity)>.1&&/^2010\s*:\s*\d.*%/.test(txt(e)));
      const value=tooltip?txt(tooltip):/2010\D+\d.*%/.test(label)?label:'';
      bucket=points[0]&&f===points[0]?'ano2010':points[1]&&f===points[1]?'ano2022':f===notes?'fontes':'outside';
      adapterOk=location.href===url&&points.length===2&&!!notes&&!!panel&&!!main?.textContent.includes('Escolarização');
      x={fontesAbertas:vis(panel),valor2010:value,pontos:points.length,
        rotuloPonto:label,marcador2010:points[0]?.outerHTML.slice(0,340)};
    }else{
      const main=document.querySelector('#mainChart');
      const all=[...main?.querySelectorAll('.tab-item a')??[]];
      const btn=t=>all.find(e=>txt(e)===t);
      const line=btn('Line'),bar=btn('Bar'),map=btn('Map');
      const also=main?.querySelector('#ContextualDropdown'),share=main?.querySelector('button.share'),
        details=main?.querySelector('button.openinnew'),license=main?.querySelector('a.info-b');
      const view=txt(all.find(a=>a.classList.contains('active')));
      const barChart=vis(main?.querySelector('.view.chart svg.bar-chart'));
      bucket=f===license?'licenca':f===also?'also':f===share?'share':f===details?'details':f===bar?'bar_foco':f===line?'line_foco':f===map?'map_foco':'outside';
      const base=new URL(url);
      adapterOk=location.origin===base.origin&&location.pathname===base.pathname&&!!(line&&bar&&map&&also&&share&&details&&license)
        &&(view==='Line'?vis(main.querySelector('.view.chart svg.line-chart')):view==='Bar'&&barChart);
      x={view,barChart,barVisible:vis(bar),barMarkup:bar?.outerHTML.slice(0,390),
        noTabControls:[line,bar,map].every(e=>e&&!e.hasAttribute('href')&&!e.hasAttribute('tabindex'))};
    }
    const name=bucket==='outside'&&f?.tagName==='DIV'?'':txt(f);
    return {adapterOk,url:location.href,title:document.title,time:new Date().toISOString(),
      focus:{tag:f?.tagName,id:f?.id??'',bucket,name,visible:vis(f),
        signature:JSON.stringify([bucket,f?.tagName,f?.id??'',name,f?.getAttribute('href')??''])},
      [id]:x,viewport:{width:innerWidth,height:innerHeight}};
  },{id:model.id,url:model.url,pontos:pronto.ibge});
}

export function conferePortal(m,s,o){
  if(!o?.adapterOk)return false;
  const f=o.focus.bucket;
  if(m.id==='ibge'){
    if(s==='pagina')return !o.ibge.fontesAbertas&&!o.ibge.valor2010;
    if(s==='valor2010')return !!o.ibge.valor2010&&f==='ano2010';
    if(s==='fontes_abertas')return o.ibge.fontesAbertas&&f==='fontes';
    return !o.ibge.fontesAbertas&&s===f;
  }
  if(s==='pagina')return o.banco.view==='Line';
  if(s==='barras')return o.banco.view==='Bar'&&o.banco.barChart;
  if(s==='bar_foco')return f==='bar_foco';
  return o.banco.view==='Line'&&s===f;
}

export function falhaPortal(tr,o){
  if(!o?.adapterOk)return null;
  if(tr.id==='I08'&&o.focus.bucket==='ano2010'&&!o.ibge.valor2010)
    return 'O ponto de 2010 recebeu foco, mas o valor não apareceu com Enter nem Espaço.';
  if(tr.id==='B08'&&o.focus.bucket==='also'&&o.banco.view==='Line'&&o.banco.barVisible&&o.banco.noTabControls)
    return 'Tab foi da licença para Also Show, pulando Bar e mantendo o gráfico em linhas.';
  return null;
}
