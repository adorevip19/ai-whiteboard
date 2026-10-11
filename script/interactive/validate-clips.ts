import fs from 'node:fs';
import {decodeAudio} from '../../server/interactive/assess';
const audio=await decodeAudio(fs.readFileSync('output/interactive-qa/q4.wav').toString('base64'));console.log({wavDecoded:true,seconds:audio.seconds});
