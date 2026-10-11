import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiTts, extractWav, prepareTts, TtsError } from './geminiTts';

const wav = Buffer.alloc(48);
wav.write('RIFF'); wav.writeUInt32LE(40,4); wav.write('WAVE',8);
const audioResponse = () => new Response(JSON.stringify({steps:[{type:'model_output',content:[{type:'audio',data:wav.toString('base64')}]}]}));

test('mixed-language transcript is verbatim; teacher directions are metadata, never narration', () => {
  const text = '注意，beach，中间的长音拉开一点。轮到你啦！';
  const { request, voice } = prepareTts({text});
  assert.equal(voice,'Sulafat');
  assert.equal(request.model,'gemini-3.8-flash-tts');
  assert.equal(request.input[0].content[0].text,text);
  assert.match(request.input[0].content[0].annotations[0].style,/anticipatory pause/);
  assert.match(request.input[0].content[0].annotations[0].style,/encouraging finish/);
  assert.equal(request.response_format.mime_type,'audio/wav');
});

test('bad input/legacy Azure voices fail before spending API quota', async () => {
  let calls = 0;
  const synth = createGeminiTts(async () => {calls++;return audioResponse()});
  for (const text of ['', 'a'.repeat(1201)]) await assert.rejects(synth({text},{apiKey:'test'}),e => e instanceof TtsError && e.status===400);
  await assert.rejects(synth({text:'hello',voice:'zh-CN-XiaoxiaoNeural'},{apiKey:'test'}));
  await assert.rejects(synth({text:'hello'},{}),e => e instanceof TtsError && e.status===501);
  assert.equal(calls,0);
});

test('cache reuses successful audio but isolates voice, rate and credentials', async () => {
  let calls=0;
  const synth=createGeminiTts(async (_url,init)=>{
    calls++; assert.equal(new Headers(init?.headers).get('x-goog-api-key'),calls===4?'other':'test');
    return audioResponse();
  });
  const first=await synth({text:'beach'},{apiKey:'test'});
  assert.deepEqual(first.audio,wav);
  assert.equal((await synth({text:'beach'},{apiKey:'test'})).cached,true);
  await synth({text:'beach',voice:'Kore'},{apiKey:'test'});
  await synth({text:'beach',rate:0.8},{apiKey:'test'});
  await synth({text:'beach'},{apiKey:'other'});
  assert.equal(calls,4);
});

test('upstream failure never leaks a key and is never cached', async () => {
  let calls=0;
  const synth=createGeminiTts(async ()=>{calls++;return calls===1?new Response('secret-key',{status:429}):audioResponse()});
  await assert.rejects(synth({text:'hello'},{apiKey:'secret-key'}),e=>e instanceof TtsError && e.status===429 && !e.message.includes('secret-key'));
  assert.equal((await synth({text:'hello'},{apiKey:'secret-key'})).cached,false);
  assert.equal(calls,2);
  assert.throws(()=>extractWav({steps:[]}),TtsError);
  assert.throws(()=>extractWav({steps:[{type:'model_output',content:[{type:'audio',data:'garbage'}]}]}),TtsError);
});

test('cancellation reaches upstream and does not populate cache', async () => {
  const ctrl=new AbortController();
  const synth=createGeminiTts(async (_url,init)=>new Promise((_resolve,reject)=>{
    init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});
  }));
  const pending=synth({text:'hello'},{apiKey:'test',signal:ctrl.signal});
  ctrl.abort();
  await assert.rejects(pending,e=>e instanceof Error && e.name==='AbortError');
});

test('upstream timeout is a retriable 504', async () => {
  const synth=createGeminiTts(async (_url,init)=>new Promise((_resolve,reject)=>{
    const alive=setTimeout(()=>{},100);
    init!.signal!.addEventListener('abort',()=>{clearTimeout(alive);reject(init!.signal!.reason)},{once:true});
  }),5);
  await assert.rejects(synth({text:'hello'},{apiKey:'test'}),e=>e instanceof TtsError && e.status===504);
});
