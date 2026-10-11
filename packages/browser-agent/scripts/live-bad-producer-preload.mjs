// Controlled producer responses ONLY. The independent verifier calls real zero-cost providers.
import {readFileSync} from 'node:fs';
const original = globalThis.fetch;
globalThis.fetch = async (input, init={}) => {
 const url = String(input instanceof Request ? input.url : input);
 if (!url.includes('/chat/completions')) return original(input,init);
 const body = JSON.parse(String(init.body ?? '{}'));
 if (body.messages?.[0]?.content?.includes('independent objective verifier')) return original(input,init);
 const scenario = JSON.parse(readFileSync(process.env.LIVE_BAD_PRODUCER_SCENARIO,'utf8'));
 if (!scenario.badAnswer && scenario.badAnswer !== '') return original(input,init);
 return new Response(JSON.stringify({model:body.model,choices:[{message:{content:scenario.badAnswer},finish_reason:'stop'}],usage:{total_tokens:0,cost:0}}),{status:200,headers:{'content-type':'application/json'}});
};
