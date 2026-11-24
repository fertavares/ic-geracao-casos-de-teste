import {spawn} from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
export const executable=()=>fileURLToPath(new URL(`../bin/${os.platform()==='win32'?'aprendiz.exe':'aprendiz'}`,import.meta.url));
export class Aprendiz {
  constructor(){
    this.proc=spawn(executable(),[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.pending=[];this.failure=null;this.stderr='';
    this.proc.stderr.on('data',d=>this.stderr+=d.toString());
    this.lines=readline.createInterface({input:this.proc.stdout});
    this.lines.on('line',line=>{const p=this.pending.shift();if(p)p.resolve(line.split('\t'));});
    const fail=e=>{this.failure=e;for(const p of this.pending.splice(0))p.reject(e);};
    this.proc.on('error',()=>fail(new Error('Aprendiz Haskell indisponivel. Rode npm.cmd run compilar.')));
    this.proc.on('exit',code=>{if(code!==0)fail(new Error(`Haskell encerrou (${code}): ${this.stderr}`));});
  }
  command(parts){
    if(this.failure)return Promise.reject(this.failure);
    if(parts.some(p=>/[\t\r\n]/.test(String(p))))throw new Error('Campo invalido no protocolo Haskell.');
    return new Promise((resolve,reject)=>{this.pending.push({resolve,reject});this.proc.stdin.write(parts.join('\t')+'\n');});
  }
  async init(config,seed,mode){
    const r=await this.command(['INIT',seed,config.alpha,config.gamma,config.epsilon,mode]);
    if(r[0]!=='OK')throw new Error('Parametros rejeitados pelo Haskell.');
  }
  async choose(state,actions){
    const r=await this.command(['CHOOSE',state,actions.join(',')]);
    if(r[0]!=='ACTION'||!actions.includes(r[1]))throw new Error('Resposta invalida do aprendiz.');
    return {action:r[1],mode:r[2],q:Number(r[3])};
  }
  async learn(s,a,reward,next,actions,terminal){
    const r=await this.command(['LEARN',s,a,reward,next,actions.join(',')||'-',terminal?1:0]);
    if(r[0]!=='UPDATED')throw new Error('Atualizacao Q rejeitada.');
    return {old:Number(r[1]),future:Number(r[2]),new:Number(r[3])};
  }
  close(){this.proc.stdin.end();this.lines.close();this.proc.kill();}
}
