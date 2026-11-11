import { mkdirSync,lstatSync,openSync,readFileSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync,constants,fstatSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { createHash } from 'node:crypto';
export const JOURNAL_BYTES=20*1024*1024+4096;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:@|-]{1,80}$/.test(v);
function valid(value){if(!value||typeof value!=='object'||Array.isArray(value)||value.v!==1||!id(value.workerId)||!id(value.claimRequestId))return false;const basic=['v','phase','workerId','claimRequestId'];if(['claiming','replaying'].includes(value.phase))return Object.keys(value).length===4&&basic.every(k=>Object.hasOwn(value,k));if(!['submitting','retrying'].includes(value.phase)||!id(value.requestId)||!value.body||typeof value.body!=='object'||Array.isArray(value.body))return false;return Object.keys(value).length===6&&[...basic,'requestId','body'].every(k=>Object.hasOwn(value,k));}
const hash=text=>createHash('sha256').update(text).digest('hex');
export class Journal {
  constructor(directory='/var/lib/shooter-journal'){
    if(typeof directory!=='string'||!directory.startsWith('/')||resolve(directory)!==directory)throw new Error('journal_configuration');
    // Check every existing ancestor before mkdir can follow an unexpected link.
    for(let path=directory;;path=dirname(path)){try{const info=lstatSync(path);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('journal_permissions');}catch(e){if(e.code!=='ENOENT')throw new Error('journal_permissions');}if(path==='/')break;}
    mkdirSync(directory,{recursive:true,mode:0o700});
    const info=lstatSync(directory);
    if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o077)!==0)throw new Error('journal_permissions');
    this.directory=directory;this.current=join(directory,'current.json');this.next=join(directory,'current.next');
    this.value=null;
  }
  check(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o077)!==0||s.size>JOURNAL_BYTES)throw new Error('journal_corrupt');return s;}
  load(){
    let info;try{info=this.check(this.current);}catch(e){if(e.code!=='ENOENT')throw new Error('journal_corrupt');}
    if(info){let fd,envelope;try{fd=openSync(this.current,constants.O_RDONLY|constants.O_NOFOLLOW);const actual=fstatSync(fd);if(!actual.isFile()||actual.nlink!==1||actual.size>JOURNAL_BYTES||(actual.mode&0o077)!==0)throw new Error('invalid');envelope=JSON.parse(readFileSync(fd,'utf8'));
        if(!envelope||envelope.v!==1||Object.keys(envelope).length!==3||envelope.sha256!==hash(JSON.stringify(envelope.data)))throw new Error('invalid');this.value=envelope.data;
      }catch{throw new Error('journal_corrupt');}finally{if(fd!==undefined)closeSync(fd);}
      if(!valid(this.value))throw new Error('journal_corrupt');
    }
    // A leftover temp file may be uncertain private evidence. Never silently
    // unlink/overwrite it on restart; operator recovery must inspect it privately.
    try{this.check(this.next);throw new Error('journal_uncertain_temporary');}catch(e){if(e.code!=='ENOENT')throw new Error('journal_corrupt');}
    return this.value;
  }
  syncDirectory(){const fd=openSync(this.directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
  save(value){
    if(!valid(value))throw new Error('journal_corrupt');
    try{this.check(this.current);}catch(e){if(e.code!=='ENOENT')throw new Error('journal_corrupt');}
    const payload=JSON.stringify(value),text=JSON.stringify({v:1,sha256:hash(payload),data:value});
    if(Buffer.byteLength(text)>JOURNAL_BYTES)throw new Error('journal_oversized');
    let fd;
    try{fd=openSync(this.next,'wx',0o600);writeFileSync(fd,text);fsyncSync(fd);}catch{throw new Error('journal_write_failure');}finally{if(fd!==undefined)closeSync(fd);}
    try{renameSync(this.next,this.current);this.syncDirectory();}catch{throw new Error('journal_write_failure');}
    this.value=value;
  }
  clear(){
    this.check(this.current);unlinkSync(this.current);this.syncDirectory();this.value=null;
  }
}
