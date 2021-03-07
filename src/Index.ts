export {ParserParms, parseTemplate, ParsedTemplate} from "./MiniTemplatorParser";
export {MiniTemplator} from "./MiniTemplator";
export {MiniTemplatorCacheParms, MiniTemplatorCache} from "./MiniTemplatorCache";

import {ParserParms, parseTemplate} from "./MiniTemplatorParser";
import {MiniTemplator} from "./MiniTemplator";

export async function createMiniTemplator (pParms: Partial<ParserParms>) : Promise<MiniTemplator> {
   const template = await parseTemplate(pParms);
   return new MiniTemplator(template); }
