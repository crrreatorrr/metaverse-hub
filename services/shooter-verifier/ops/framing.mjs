// Local-only IPC. Fixed framing, one message per connection, no raw diagnostics.
export const FRAME_BYTES = 20 * 1024 * 1024 + 1024;
export const FRAME_CHUNKS = 4096;
export function encodeFrame(value) {
  const text=JSON.stringify(value),bytes=Buffer.byteLength(text);
  if(bytes<2||bytes>FRAME_BYTES)throw new Error('ipc_frame_size');
  const out=Buffer.allocUnsafe(4+bytes);out.writeUInt32BE(bytes);out.write(text,4,'utf8');return out;
}
export class FrameReader {
  constructor(onValue,onError){this.header=Buffer.alloc(4);this.headerAt=0;this.body=null;this.at=0;this.chunks=0;this.done=false;this.onValue=onValue;this.onError=onError;}
  fail(){if(this.done)return;this.done=true;this.body=null;this.onError();}
  push(chunk){
    if(this.done){if(chunk.length)this.onError();return;}
    if(++this.chunks>FRAME_CHUNKS){this.fail();return;}
    let at=0;
    if(this.headerAt<4){const n=Math.min(4-this.headerAt,chunk.length);chunk.copy(this.header,this.headerAt,at,at+n);this.headerAt+=n;at+=n;
      if(this.headerAt<4)return;
      const length=this.header.readUInt32BE();if(length<2||length>FRAME_BYTES){this.fail();return;}this.body=Buffer.allocUnsafe(length);
    }
    const n=Math.min(this.body.length-this.at,chunk.length-at);chunk.copy(this.body,this.at,at,at+n);this.at+=n;at+=n;
    if(at!==chunk.length){this.fail();return;}
    if(this.at===this.body.length){let value;try{value=JSON.parse(this.body.toString('utf8'));}catch{this.fail();return;}
      this.done=true;this.body=null;this.onValue(value);
    }
  }
  end(){if(!this.done)this.fail();}
}
export const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const ipcId=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v);
