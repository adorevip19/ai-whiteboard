import fs from "node:fs";
import path from "node:path";
import {randomUUID} from 'node:crypto';
import {courseSchema} from '../../shared/interactive';
import {InteractiveStore} from '../../server/interactive/store';
const out='output/interactive-qa/full-visual-run.json';
if(fs.existsSync(out))throw Error('reuse existing visual run');
const c=courseSchema.parse(JSON.parse(fs.readFileSync('course-bundles/candy-quest-full/course.json','utf8')));const s=new InteractiveStore(path.resolve('interactive-data'));const r=s.create(c,true);
for(const item of c.items.slice(0,22)){const a=s.reserve(r.id,item.id,randomUUID(),c);s.finish(a.attempt.id,c,{outcome:'graded',score:100,goalMet:true,transcript:item.reference,reason:'工程模拟，用于复述页界面验收',criteria:item.rubric.map(x=>({id:x.id,met:true})),evidence:{simulation:true}});}
fs.writeFileSync(out,JSON.stringify({testOnly:true,runId:r.id},null,2));console.log(r.id);s.db.close();
