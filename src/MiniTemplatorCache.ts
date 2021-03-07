import {ParsedTemplate, ParserParms, parseTemplate} from "./MiniTemplatorParser";
import {MiniTemplator} from "./MiniTemplator";
import * as Path from "path";
import * as Fs from "fs";

export interface MiniTemplatorCacheParms {
   templateDir:                        string;                       // path of the root directory of the template files
   shortFormEnabled:                   boolean; }                    // true to enable the short form of commands ("<$...>")

/**
* A cache manager for parsed MiniTemplator objects.
*
* This class is used to cache parsed MiniTemplator objects in memory, so that a
* template file is only read and parsed once for a specific set-up of condition variables.
*/
export class MiniTemplatorCache {

   private cache:                      Map<string,ParsedTemplate>;   // parsed templates
   private cParms:                     MiniTemplatorCacheParms;

   public constructor (cParms: Partial<MiniTemplatorCacheParms>) {
      this.cParms = this.completeCacheParms(cParms);
      this.cache = new Map(); }

   private completeCacheParms (cParms: Partial<MiniTemplatorCacheParms>) : MiniTemplatorCacheParms {
      return {
         templateDir:      cParms.templateDir      ?? ".",
         shortFormEnabled: cParms.shortFormEnabled ?? false }; }

   /**
   * Returns a MiniTemplator object.
   */
   public async get (templateName: string, conditionVars?: Map<string,any>) {
      let cacheKey: string;
      if (conditionVars) {
         cacheKey = templateName + "|" + genConditionVarsCacheKey(conditionVars); }
       else {
         cacheKey = templateName; }
      let template = this.cache.get(cacheKey);
      if (!template) {
         const pParms: Partial<ParserParms> = {
            mainTemplateName: templateName,
            conditionVars,
            shortFormEnabled: this.cParms.shortFormEnabled,
            loadTemplateFile: this.loadTemplateFile};
         template = await parseTemplate(pParms);
         this.cache.set(cacheKey, template); }
      return new MiniTemplator(template); }

   /**
   * Clears the cache.
   */
   public clear() {
      this.cache.clear(); }

   private loadTemplateFile = (templateName: string) : Promise<string> => {
      const fileName = Path.join(this.cParms.templateDir, templateName);
      return Fs.promises.readFile(fileName, {encoding: "utf8"}); }; }

// A simple function to create a cache key for a set-up of condition variables.
// The returned string contains the names and values of the variables.
// Variables with the following values are ignored: false, undefined, null, "".
// Numbers are encoded as strings.
// The boolean value `true` is omitted in the output.
// Object values are not supported.
function genConditionVarsCacheKey (conditionVars: Map<string,any>) : string {
   const sortedVarNames = Array.from(conditionVars.keys()).sort();
   const out = [];
   for (const varName of sortedVarNames) {
      const varValue = conditionVars.get(varName);
      if (varValue === false || varValue === undefined || varValue === null || varValue === "") {
         /* ignore variable */ }
       else if (varValue === true) {
         out.push(varValue); }                                       // store variable name but ignore variable value
       else {
         const encodedValue = encodeConditionVarValue(varValue);
         out.push(varValue + "=" + encodedValue); }}
   return out.join("\x1E"); }

function encodeConditionVarValue (v: any) : string {
   switch (typeof v) {
      case "string": {
         return v; }
      case "number": {
         return v.toString(); }
      default: {
         throw new Error("Unsupported data type of a condition variable value."); }}}
