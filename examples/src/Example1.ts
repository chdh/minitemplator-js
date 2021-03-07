import {MiniTemplatorCache} from "minitemplator";
import * as Fs from "fs";

const templateDir      = "templates";
const templateFileName = "template1.html";
const outputFileName   = "temp-example1-out.html";
const conditionVars = new Map<string,any>([
   ["a", 2],
   ["b", true]
]);

async function test1() {
   const cache = new MiniTemplatorCache({templateDir, shortFormEnabled: true});
   const t = await cache.get(templateFileName, conditionVars);

   t.setVariableEsc("createdTimestamp", new Date());

   for (let i = 1; i <= 10; i++) {
      for (let j = 1; j <= 10; j++) {
         t.setVariable("cellValue", i * j);
         t.addBlock("cell");
      }
      t.addBlock("row");
   }

   const out = t.generateOutputString();
   Fs.writeFileSync(outputFileName, out);
}

void test1();
