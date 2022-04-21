export {ParserParms, parseTemplate, ParsedTemplate} from "./MiniTemplatorParser.js";
export {MiniTemplator} from "./MiniTemplator.js";
export {MiniTemplatorCacheParms, MiniTemplatorCache} from "./MiniTemplatorCache.js";

import {ParserParms, parseTemplate} from "./MiniTemplatorParser.js";
import {MiniTemplator} from "./MiniTemplator.js";

export async function createMiniTemplator (pParms: Partial<ParserParms>) : Promise<MiniTemplator> {
   const template = await parseTemplate(pParms);
   return new MiniTemplator(template); }
