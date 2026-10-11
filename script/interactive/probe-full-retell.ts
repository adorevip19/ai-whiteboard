import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { InteractiveStore } from "../../server/interactive/store";
import { assess, decodeAudio } from "../../server/interactive/assess";
import { itemSchema } from "../../shared/interactive";
const root="/Users/tianyufeng/Desktop/孩子学习/HFF/Unit 5/The Candy Quest 互动精讲/中英穿插完整版_网页互动课堂";
const c=JSON.parse(fs.readFileSync(path.join(root,"course-draft.json"),"utf8"));const item=itemSchema.parse(c.items.find((i:any)=>i.id==='q23'));
const store=new InteractiveStore(path.resolve('output/interactive-qa/probe-db'));
for(const name of ['complete','missing-ending']) {
 const file=path.join(root,`制作文件/retell-${name}-result.json`);
 if(fs.existsSync(file)){console.log('reuse',name);continue;}
 fs.writeFileSync(file,JSON.stringify({state:'submitted',automaticRetries:0}),{flag:'wx'});
 try {const {wav,seconds}=await decodeAudio(fs.readFileSync(path.join(root,`制作文件/retell-${name}.wav`)).toString('base64'));const result=await assess(item,wav,seconds,store);fs.writeFileSync(file,JSON.stringify({state:'complete',testOnly:true,result},null,2));console.log(name,result.goalMet,result.score,result.criteria);}
 catch(e){fs.writeFileSync(file,JSON.stringify({state:'failed_no_retry',error:String(e)}));console.log('failed');}
}
store.db.close();
