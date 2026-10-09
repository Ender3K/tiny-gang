export class MemoryDatabase {
  constructor(data = {}) { this.data = structuredClone(data); this.listeners = new Map(); }
  read(path) { return structuredClone(path.split('/').filter(Boolean).reduce((obj, key) => obj?.[key], this.data) ?? null); }
  put(path, value) {
    const parts = path.split('/').filter(Boolean), key = parts.pop(); let target = this.data;
    for (const part of parts) target = target[part] ||= {};
    if (value === null) delete target[key]; else target[key] = structuredClone(value);
    for (const [watched, listeners] of this.listeners) {
      if (watched === path || path.startsWith(watched+'/') || watched.startsWith(path+'/')) {
        for (const callback of listeners) callback({val:() => this.read(watched)});
      }
    }
  }
  ref(path) {
    return {get:async () => ({val:() => this.read(path)}), set:async value => this.put(path,value),
      transaction:async fn => {
        const next = fn(this.read(path));
        if (next !== undefined) this.put(path,next);
        return {committed:next !== undefined, snapshot:{val:() => this.read(path)}};
      },
      on:(event, callback) => {if (!this.listeners.has(path)) this.listeners.set(path,new Set()); this.listeners.get(path).add(callback); callback({val:()=>this.read(path)});},
      off:(event, callback) => this.listeners.get(path)?.delete(callback)};
  }
}
export class FakeSocket extends EventTarget {
  static sockets = [];
  constructor(url) {super(); this.url = url; this.closed = false; FakeSocket.sockets.push(this);}
  sendFixture(data) {this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  close() {if (!this.closed) {this.closed = true; this.dispatchEvent(new Event('close'));}}
}
export function manualTimers() {
  const pending = new Map(); let next = 0;
  return {pending,setTimeout:(fn,delay) => {pending.set(++next,{fn,delay});return next;},clearTimeout:id => pending.delete(id),
    run:delay => {for (const [id,item] of [...pending]) if (item.delay === delay) {pending.delete(id); item.fn();}}};
}
export const settle = async () => {for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));};
export function room(now = Date.now()) {return {state:'playing',currentSlide:1,rounds:{1:{openedAt:now-1000}},timer:{slide:1,status:'running',enabled:true,paused:false,dueAt:now+10000}};}
export const welcome = id => ({metadata:{message_type:'session_welcome'},payload:{session:{id,keepalive_timeout_seconds:10}}});
export function notification(text, userId = '10', sentAt = Date.now(), messageId = Math.random().toString()) {
  return {metadata:{message_type:'notification',message_id:messageId,message_timestamp:new Date(sentAt).toISOString()},
    payload:{subscription:{type:'channel.chat.message',condition:{broadcaster_user_id:'42'}},event:{broadcaster_user_id:'42',chatter_user_id:userId,message:{text}}}};
}
