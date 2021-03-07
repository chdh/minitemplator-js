import {assert} from "./Utils";
import * as Fs from "fs";

const maxNestingLevel                  = 30;                         // maximum number of block nestings
const maxCondLevels                    = 30;                         // maximum number of nested conditional commands ($if)
const maxInclTemplateSize              = 1000000;                    // maximum length of template string when including subtemplates
const cmdStartStr                      = "<!--";                     // command start string
const cmdEndStr                        = "-->";                      // command end string
const cmdStartStrShort                 = "<$";                       // short form command start string
const cmdEndStrShort                   = ">";                        // short form command end string

export class TemplateSyntaxError extends Error {                     // thrown when a syntax error is encountered within the template
   public constructor (msg: string) {
      super("Syntax error in template: " + msg); }}

export interface ParserParms {                                       // input parameters for the template parser
   mainTemplateName:                   string;                       // name of the main template
   conditionVars:                      Map<string,any>;              // condition variables
      // Condition variables are used by the parser to evaluate the expressions of "$if" statements.
   shortFormEnabled:                   boolean;                      // true to enable the short form of commands ("<$...>")
   loadTemplateFile:                   (templateName: string) => Promise<string>; }
      // Function to load a template file. Used for the main template and for subtemplates (with the $include command).

export interface VarRefTabRec {                                      // variable reference table record structure
   varNo:                              number;                       // variable no
   tPosBegin:                          number;                       // template position of begin of variable reference
   tPosEnd:                            number;                       // template position of end of variable reference
   blockNo:                            number;                       // block no of the (innermost) block that contains this variable reference
   blockVarNo:                         number; }                     // block variable no. Index into BlockInstTab.BlockVarTab

export interface BlockTabRec {                                       // block table record structure
   blockName?:                         string;                       // block name
   nextWithSameName:                   number;                       // block no of next block with same name or -1 (blocks are backward linked related to their position within the template)
   tPosBegin:                          number;                       // template position of begin of block
   tPosContentsBegin:                  number;                       // template pos of begin of block contents
   tPosContentsEnd:                    number;                       // template pos of end of block contents
   tPosEnd:                            number;                       // template position of end of block
   nestingLevel:                       number;                       // block nesting level
   parentBlockNo:                      number;                       // block no of parent block
   definitionIsOpen:                   boolean;                      // true while $beginBlock processed but no $endBlock
   blockVarNoToVarNoMap:               number[];                     // maps block variable numbers to variable numbers
   firstVarRefNo:                      number;                       // variable reference no of first variable of this block or -1
   dummy:                              boolean; }                    // true if this is a dummy block that will never be included in the output

export interface ParsedTemplate {                                    // represents a parsed template
   templateText:                       string;                       // template text with subtemplates inserted
   varTab:                             string[];                     // variable table, contains variable names, array index is variable no
   varRefTab:                          VarRefTabRec[];               // variable references table
      // Contains an entry for each variable reference in the template. Ordered by templatePos.
   blockTab:                           BlockTabRec[];                // block table, array index is block no
      // Contains an entry for each block in the template. Ordered by tPosBegin.
   lookupVariableName:                 (varName: string) => number;
      // Maps a variable name to a variable number. Returns -1 if the variable name is not found.
   lookupBlockName:                    (blockName: string) => number; }
      // Maps a block name to a block number. Returns -1 if the block name is not found.
      // If there are multiple blocks with the same name, the block number of the last registered block with that name is returned.

export function parseTemplate (pParms: Partial<ParserParms>) : Promise<ParsedTemplate> {
   const parser = new Parser();
   return parser.main(pParms); }

class Parser {

   private pParms:                     ParserParms;                  // parser input parameters
   private templateText:               string;                       // template text, subtemplates are inserted within the main template text
   private conditionVarNames:          string[];                     // names of the condition variables
   private conditionVarValues:         any[];                        // values of the condition variables

   private varTab:                     string[];                     // variable table, contains variable names, array index is variable no
   private varNameToNoMap:             Map<string,number>;           // maps variable names to variable numbers
   private varRefTab:                  VarRefTabRec[];               // variable reference table
      // Contains an entry for each variable reference in the template. Ordered by templatePos.

   private blockTab:                   BlockTabRec[];                // block table, array index is block no
      // Contains an entry for each block in the template. Ordered by tPosBegin.
   private blockNameToNoMap:           Map<string,number>;           // maps block names to block numbers

   // The following variables are only used temporarily during parsing of the template.
   private currentNestingLevel:        number;                       // current block nesting level during parsing
   private openBlocksTab:              Int16Array;                   // indexed by the block nesting level
      // During parsing, this table contains the block numbers of the open parent blocks (nested outer blocks).
   private condLevel:                  number;                       // current nesting level of conditional commands ($if), -1 = main level
   private condEnabled:                boolean[];                    // enabled/disabled state of the conditions of each level
   private condPassed:                 boolean[];                    // true if an enabled condition clause has already been processed (separate for each level)
   private resumeCmdParsingFromStart:  boolean;                      // true = resume command parsing from the start position of the last command

   //--- Main -----------------------------------------------------------

   public async main (pParms: Partial<ParserParms>) : Promise<ParsedTemplate> {
      this.pParms = this.completeParserParms(pParms);
      await this.parseTemplate();
      return {
         templateText:       this.templateText,
         varTab:             this.varTab,
         varRefTab:          this.varRefTab,
         blockTab:           this.blockTab,
         lookupVariableName: this.lookupVariableName,
         lookupBlockName:    this.lookupBlockName}; }

   private completeParserParms (pParms: Partial<ParserParms>) : ParserParms {
      return {
         mainTemplateName:  pParms.mainTemplateName ?? "template.html",
         conditionVars:     pParms.conditionVars    ?? new Map(),
         shortFormEnabled:  pParms.shortFormEnabled ?? false,
         loadTemplateFile:  pParms.loadTemplateFile ?? ((templateName: string) => Fs.promises.readFile(templateName, {encoding: "utf8"}))}; }

   //--- Template parsing -----------------------------------------------

   private async parseTemplate() {
      await this.initParsing();
      this.beginMainBlock();
      await this.parseTemplateCommands();
      this.endMainBlock();
      this.checkBlockDefinitionsComplete();
      if (this.condLevel != -1) {
         throw new TemplateSyntaxError("$if without matching $endIf."); }
      this.parseTemplateVariables();
      this.associateVariablesWithBlocks(); }

   private async initParsing() {
      this.templateText = await this.pParms.loadTemplateFile(this.pParms.mainTemplateName);
      this.conditionVarNames = Array.from(this.pParms.conditionVars.keys());
      this.conditionVarValues = Array.from(this.pParms.conditionVars.values());
      this.varTab = [];
      this.varNameToNoMap = new Map();
      this.varRefTab = [];
      this.blockTab = [];
      this.blockNameToNoMap = new Map();
      this.currentNestingLevel = 0;
      this.openBlocksTab = new Int16Array(maxNestingLevel + 1);
      this.condLevel = -1;
      this.condEnabled = new Array(maxCondLevels).fill(false);
      this.condPassed = new Array(maxCondLevels).fill(false); }

   // Registers the main block.
   // The main block is an implicitly defined block that covers the whole template.
   private beginMainBlock() {
      const blockNo = this.registerBlock();                          // =0
      const btr = this.blockTab[blockNo];
      btr.tPosBegin = 0;
      btr.tPosContentsBegin = 0;
      this.openBlocksTab[this.currentNestingLevel] = blockNo;
      this.currentNestingLevel++; }

   // Completes the main block registration.
   private endMainBlock() {
      const btr = this.blockTab[0];
      btr.tPosContentsEnd = this.templateText.length;
      btr.tPosEnd = this.templateText.length;
      btr.definitionIsOpen = false;
      this.currentNestingLevel--; }

   //--- Template commands --------------------------------------------------------

   // Parses commands within the template in the format "<!-- $command parameters -->".
   // If shortFormEnabled is true, the short form commands in the format "<$...>" are also recognized.
   private async parseTemplateCommands() {
      let p = 0;                                                     // p is the current position within templateText
      while (true) {
         const templateText = this.templateText;
         let p0 = templateText.indexOf(cmdStartStr, p);              // p0 is the start of the current command
         let shortForm = false;
         if (this.pParms.shortFormEnabled && p0 != p) {
            if (p0 == -1) {
               p0 = templateText.indexOf(cmdStartStrShort, p);
               shortForm = true; }
             else {
               const p2 = templateText.substring(p, p0).indexOf(cmdStartStrShort);
               if (p2 != -1) {
                  p0 = p + p2;
                  shortForm = true; }}}
         if (p0 == -1) {                                             // no more commands
            break; }
         this.conditionalExclude(p, p0);                             // process text up to the start of the current command
         if (shortForm) {                                            // short form command
            p = templateText.indexOf(cmdEndStrShort, p0 + cmdStartStrShort.length);
            if (p == -1) {                                           // if no terminating ">" is found, we process it as normal text
               p = p0 + cmdStartStrShort.length;
               this.conditionalExclude(p0, p);
               continue; }
            p += cmdEndStrShort.length;
            const cmdLine = templateText.substring(p0 + cmdStartStrShort.length, p - cmdEndStrShort.length);
            if (!this.processShortFormTemplateCommand(cmdLine, p0, p)) {
               // If a short form command is not recognized, we process the whole command structure are normal text.
               this.conditionalExclude(p0, p); }}
          else {                                                     // normal (long) form command
            p = templateText.indexOf(cmdEndStr, p0 + cmdStartStr.length);
            if (p == -1) {
               throw new TemplateSyntaxError("Invalid HTML comment in template at offset " + p0 + "."); }
            p += cmdEndStr.length;
            const cmdLine = templateText.substring(p0 + cmdStartStr.length, p - cmdEndStr.length);
            this.resumeCmdParsingFromStart = false;
            if (!await this.processTemplateCommand(cmdLine, p0, p)) {
               this.conditionalExclude(p0, p); }                     // process as normal temlate text
            if (this.resumeCmdParsingFromStart) {                    // (if a subtemplate has been included)
               p = p0; }}}}

   // Returns false if the command should be treatet as normal template text.
   private async processTemplateCommand (cmdLine: string, cmdTPosBegin: number, cmdTPosEnd: number) : Promise<boolean> {
      const p0 = skipBlanks(cmdLine, 0);
      if (p0 >= cmdLine.length) {
         return false; }
      const p = skipNonBlanks(cmdLine, p0);
      const cmd = cmdLine.substring(p0, p);
      const parms = cmdLine.substring(p);
      switch (cmd) {
         case "$beginBlock": {
            this.processBeginBlockCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         case "$endBlock": {
            this.processEndBlockCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         case "$include": {
            await this.processIncludeCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         case "$if": {
            this.processIfCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         case "$elseIf": {
            this.processElseIfCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         case "$else": {
            this.processElseCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         case "$endIf": {
            this.processEndIfCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         default: {
            if (cmd.startsWith("$") && !cmd.startsWith("${")) {
               throw new TemplateSyntaxError(`Unknown command "${cmd}" in template at offset ${cmdTPosBegin}.`); }
            return false; }}
      return true; }

   // Returns false if the command is not recognized and should be treatet as normal temlate text.
   private processShortFormTemplateCommand (cmdLine: string, cmdTPosBegin: number, cmdTPosEnd: number) : boolean {
      const p0 = skipBlanks(cmdLine, 0);
      if (p0 >= cmdLine.length) {
         return false; }
      let p = p0;
      const cmd1 = cmdLine[p++];
      if (cmd1 == "/" && p < cmdLine.length && !isWhiteSpaceAt(cmdLine, p)) {
         p++; }
      const cmd = cmdLine.substring(p0, p);
      const parms = cmdLine.substring(p).trim();
      switch (cmd) {
         case "?": {
            this.processIfCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         case ":": {
            if (parms.length > 0) {
               this.processElseIfCmd(parms, cmdTPosBegin, cmdTPosEnd); }
             else {
               this.processElseCmd(parms, cmdTPosBegin, cmdTPosEnd); }
            break; }
         case "/?": {
            this.processEndIfCmd(parms, cmdTPosBegin, cmdTPosEnd);
            break; }
         default: {
            return false; }}
      return true; }

   // Processes the $beginBlock command.
   private processBeginBlockCmd (parms: string, cmdTPosBegin: number, cmdTPosEnd: number) {
      if (this.conditionalExclude(cmdTPosBegin, cmdTPosEnd)) {
         return; }
      const p0 = skipBlanks(parms, 0);
      if (p0 >= parms.length) {
         throw new TemplateSyntaxError("Missing block name in $beginBlock command in template at offset " + cmdTPosBegin + "."); }
      const p = skipNonBlanks(parms, p0);
      const blockName = parms.substring(p0, p);
      if (!isRestOfStringBlank(parms, p)) {
         throw new TemplateSyntaxError("Extra parameter in $beginBlock command in template at offset " + cmdTPosBegin + "."); }
      const blockNo = this.registerBlock(blockName);
      const btr = this.blockTab[blockNo];
      btr.tPosBegin = cmdTPosBegin;
      btr.tPosContentsBegin = cmdTPosEnd;
      this.openBlocksTab[this.currentNestingLevel] = blockNo;
      this.currentNestingLevel++;
      if (this.currentNestingLevel > maxNestingLevel) {
         throw new TemplateSyntaxError(`Block nesting overflow for block "${blockName}" in template at offset ${cmdTPosBegin}.`); }}

   // Processes the $endBlock command.
   private processEndBlockCmd (parms: string, cmdTPosBegin: number, cmdTPosEnd: number) {
      if (this.conditionalExclude(cmdTPosBegin, cmdTPosEnd)) {
         return; }
      const p0 = skipBlanks(parms, 0);
      if (p0 >= parms.length) {
         throw new TemplateSyntaxError("Missing block name in $endBlock command in template at offset " + cmdTPosBegin + "."); }
      const p = skipNonBlanks(parms, p0);
      const blockName = parms.substring(p0, p);
      if (!isRestOfStringBlank(parms, p)) {
         throw new TemplateSyntaxError("Extra parameter in $endBlock command in template at offset " + cmdTPosBegin + "."); }
      const blockNo = this.lookupBlockName(blockName);
      if (blockNo == -1) {
         throw new TemplateSyntaxError(`Undefined block name "${blockName}" in $endBlock command in template at offset ${cmdTPosBegin}.`); }
      this.currentNestingLevel--;
      const btr = this.blockTab[blockNo];
      if (!btr.definitionIsOpen) {
         throw new TemplateSyntaxError(`Multiple $endBlock commands for block "${blockName}" in template at offset ${cmdTPosBegin}.`); }
      if (btr.nestingLevel != this.currentNestingLevel) {
         throw new TemplateSyntaxError(`Block nesting level mismatch at $endBlock command for block "${blockName}" in template at offset ${cmdTPosBegin}.`); }
      btr.tPosContentsEnd = cmdTPosBegin;
      btr.tPosEnd = cmdTPosEnd;
      btr.definitionIsOpen = false; }

   // Returns the block number of the newly registered block.
   private registerBlock (blockName?: string) : number {
      const blockNo = this.blockTab.length;
      const btr = <BlockTabRec>{};
      btr.blockName = blockName;
      if (blockName != null) {
         btr.nextWithSameName = this.lookupBlockName(blockName); }
       else {
         btr.nextWithSameName = -1; }
      btr.nestingLevel = this.currentNestingLevel;
      if (this.currentNestingLevel > 0) {
         btr.parentBlockNo = this.openBlocksTab[this.currentNestingLevel - 1]; }
       else {
         btr.parentBlockNo = -1; }
      btr.definitionIsOpen = true;
      btr.firstVarRefNo = -1;
      btr.blockVarNoToVarNoMap = [];
      btr.dummy = false;
      if (blockName != null) {
         this.blockNameToNoMap.set(blockName, blockNo); }
      this.blockTab.push(btr);
      return blockNo; }

   // Registers a dummy block to exclude a range within the template text.
   private excludeTemplateRange (tPosBegin: number, tPosEnd: number) {
      if (this.blockTab.length > 0) {
         // Check whether we can extend the previous block.
         const btr = this.blockTab[this.blockTab.length - 1];
         if (btr.dummy && btr.tPosEnd == tPosBegin) {
            btr.tPosContentsEnd = tPosEnd;
            btr.tPosEnd = tPosEnd;
            return; }}
      const blockNo = this.registerBlock();
      const btr = this.blockTab[blockNo];
      btr.tPosBegin = tPosBegin;
      btr.tPosContentsBegin = tPosBegin;
      btr.tPosContentsEnd = tPosEnd;
      btr.tPosEnd = tPosEnd;
      btr.definitionIsOpen = false;
      btr.dummy = true; }

   // Checks that all block definitions are closed.
   private checkBlockDefinitionsComplete() {
      for (let blockNo = 0; blockNo < this.blockTab.length; blockNo++) {
         const btr = this.blockTab[blockNo];
         if (btr.definitionIsOpen) {
            throw new TemplateSyntaxError(`Missing $endBlock command in template for block "${btr.blockName}".`); }}
      if (this.currentNestingLevel != 0) {
         throw new TemplateSyntaxError("Block nesting level error at end of template."); }}

   // Processes the $include command.
   private async processIncludeCmd (parms: string, cmdTPosBegin: number, cmdTPosEnd: number) {
      if (this.conditionalExclude(cmdTPosBegin, cmdTPosEnd)) {
         return; }
      let p0 = skipBlanks(parms, 0);
      if (p0 >= parms.length) {
         throw new TemplateSyntaxError("Missing subtemplate name in $include command in template at offset " + cmdTPosBegin + "."); }
      let p: number;
      if (parms[p0] == '"') {                                        // subtemplate name is quoted
         p0++;
         p = parms.indexOf('"', p0);
         if (p == -1) {
            throw new TemplateSyntaxError("Missing closing quote for subtemplate name in $include command in template at offset " + cmdTPosBegin + "."); }}
       else {
         p = skipNonBlanks(parms, p0); }
      const subTemplateName = parms.substring(p0, p);
      p++;
      if (!isRestOfStringBlank(parms, p)) {
         throw new TemplateSyntaxError("Extra parameter in $include command in template at offset " + cmdTPosBegin + "."); }
      await this.insertSubTemplate(subTemplateName, cmdTPosBegin, cmdTPosEnd); }

   private async insertSubTemplate (subTemplateName: string, tPos1: number, tPos2: number) {
      const subTemplateText = await this.pParms.loadTemplateFile(subTemplateName);
      if (this.templateText.length + subTemplateText.length > maxInclTemplateSize) {
         throw new Error(`Subtemplate include aborted because the internal template string would become longer than ${maxInclTemplateSize} characters.`); }
      this.templateText = this.templateText.substring(0, tPos1) + subTemplateText + this.templateText.substring(tPos2);
        // (Copying the template string to insert a subtemplate is slow. In a future implementation
        // an array of template fragments could be used.)
      this.resumeCmdParsingFromStart = true; }

   //--- Conditional commands -----------------------------------------------------

   // Returns the enabled/disabled state of the condition at level condLevel2.
   private isCondEnabled (condLevel2: number) : boolean {
      if (condLevel2 < 0) {
         return true; }
      return this.condEnabled[condLevel2]; }

   // If the current condition is disabled, the text from tPosBegin to tPosEnd
   // is excluded and true is returned.
   // Otherwise nothing is done and false is returned.
   private conditionalExclude (tPosBegin: number, tPosEnd: number) : boolean {
      if (this.isCondEnabled(this.condLevel)) {
         return false; }
      this.excludeTemplateRange(tPosBegin, tPosEnd);
      return true; }

   // Evaluates a condition expression of a conditional command.
   private evaluateCondition (condExpr: string) : boolean {
      try {
         const f = new Function(...this.conditionVarNames, `"use strict"; return (${condExpr})`);   // eslint-disable-line
         const r = f(...this.conditionVarValues);
         return Boolean(r); }
       catch (e) {
         throw new TemplateSyntaxError(`Invalid condition expression "${condExpr}". ${e}`); }}

   // Processes the $if command.
   private processIfCmd (parms: string, cmdTPosBegin: number, cmdTPosEnd: number) {
      this.excludeTemplateRange(cmdTPosBegin, cmdTPosEnd);
      if (this.condLevel >= maxCondLevels - 1) {
         throw new TemplateSyntaxError("Too many nested $if commands."); }
      this.condLevel++;
      const enabled = this.isCondEnabled(this.condLevel - 1) && this.evaluateCondition(parms);
      this.condEnabled[this.condLevel] = enabled;
      this.condPassed[this.condLevel] = enabled; }

   // Processes the $elseIf command.
   private processElseIfCmd (parms: string, cmdTPosBegin: number, cmdTPosEnd: number) {
      this.excludeTemplateRange(cmdTPosBegin, cmdTPosEnd);
      if (this.condLevel < 0) {
         throw new TemplateSyntaxError("$elseIf without matching $if."); }
      const enabled = this.isCondEnabled(this.condLevel - 1) && !this.condPassed[this.condLevel] && this.evaluateCondition(parms);
      this.condEnabled[this.condLevel] = enabled;
      if (enabled) {
         this.condPassed[this.condLevel] = true; }}

   // Processes the $else command.
   private processElseCmd (parms: string, cmdTPosBegin: number, cmdTPosEnd: number) {
      this.excludeTemplateRange(cmdTPosBegin, cmdTPosEnd);
      if (!isStringBlank(parms)) {
         throw new TemplateSyntaxError("Invalid parameters for $else command."); }
      if (this.condLevel < 0) {
         throw new TemplateSyntaxError("$else without matching $if."); }
      const enabled = this.isCondEnabled(this.condLevel - 1) && !this.condPassed[this.condLevel];
      this.condEnabled[this.condLevel] = enabled;
      if (enabled) {
         this.condPassed[this.condLevel] = true; }}

   // Processes the $endIf command.
   private processEndIfCmd (parms: string, cmdTPosBegin: number, cmdTPosEnd: number) {
      this.excludeTemplateRange(cmdTPosBegin, cmdTPosEnd);
      if (!isStringBlank(parms)) {
         throw new TemplateSyntaxError("Invalid parameters for $endIf command."); }
      if (this.condLevel < 0) {
         throw new TemplateSyntaxError("$endif without matching $if."); }
      this.condLevel--; }

   //------------------------------------------------------------------------------

   // Associates variable references with blocks.
   private associateVariablesWithBlocks() {
      const blockTab = this.blockTab;
      const varRefTab = this.varRefTab;
      let varRefNo = 0;
      let activeBlockNo = 0;
      let nextBlockNo = 1;
      while (varRefNo < varRefTab.length) {
         const vrtr = varRefTab[varRefNo];
         const varRefTPos = vrtr.tPosBegin;
         const varNo = vrtr.varNo;
         if (varRefTPos >= blockTab[activeBlockNo].tPosEnd) {
            activeBlockNo = blockTab[activeBlockNo].parentBlockNo;
            continue; }
         if (nextBlockNo < blockTab.length && varRefTPos >= blockTab[nextBlockNo].tPosBegin) {
            activeBlockNo = nextBlockNo;
            nextBlockNo++;
            continue; }
         const btr = blockTab[activeBlockNo];
         assert(varRefTPos >= btr.tPosBegin);
         const blockVarNo = btr.blockVarNoToVarNoMap.length;
         btr.blockVarNoToVarNoMap.push(varNo);
         if (btr.firstVarRefNo == -1) {
            btr.firstVarRefNo = varRefNo; }
         vrtr.blockNo = activeBlockNo;
         vrtr.blockVarNo = blockVarNo;
         varRefNo++; }}

   // Parses variable references within the template in the format "${VarName}" .
   private parseTemplateVariables() {
      const templateText = this.templateText;
      let p = 0;
      while (true) {
         p = templateText.indexOf("${", p);
         if (p == -1) {
            break; }
         const p0 = p;
         p = templateText.indexOf("}", p);
         if (p == -1) {
            throw new TemplateSyntaxError(`Invalid variable reference in template at offset ${p0}.`); }
         p++;
         const varName = templateText.substring(p0 + 2, p - 1).trim();
         if (varName.length == 0) {
            throw new TemplateSyntaxError(`Empty variable name in template at offset ${p0}.`); }
         this.registerVariableReference(varName, p0, p); }}

   private registerVariableReference (varName: string, tPosBegin: number, tPosEnd: number) {
      let varNo = this.lookupVariableName(varName);
      if (varNo == -1) {
         varNo = this.registerVariable(varName); }
      const vrtr = <VarRefTabRec>{};
      vrtr.tPosBegin = tPosBegin;
      vrtr.tPosEnd = tPosEnd;
      vrtr.varNo = varNo;
      this.varRefTab.push(vrtr); }

   // Returns the variable number of the newly registered variable.
   private registerVariable (varName: string) : number {
      const varNo = this.varTab.length;
      this.varTab.push(varName);
      this.varNameToNoMap.set(varName, varNo);
      return varNo; }

   //--- Name lookup routines -------------------------------------------

   // Maps a variable name to a variable number.
   // Returns -1 if the variable name is not found.
   private lookupVariableName = (varName: string) : number => {
      const varNo = this.varNameToNoMap.get(varName);
      if (varNo === undefined) {
         return -1; }
      return varNo; };

   // Maps a block name to a block number.
   // If there are multiple blocks with the same name, the block number of the last registered block with that name is returned.
   // Returns -1 if the block name is not found.
   private lookupBlockName = (blockName: string) : number => {
      const blockNo = this.blockNameToNoMap.get(blockName);
      if (blockNo === undefined) {
         return -1; }
      return blockNo; };

   } // end class Parser

//--- General utility routines ---------------------------------------

function isWhiteSpaceAt (s: string, p: number) : boolean {
   return s.charCodeAt(p) <= 32; }

// Skips blanks (white space) in string s starting at position p.
function skipBlanks (s: string, p0: number) : number {
   const len = s.length;
   let p = p0;
   while (p < len && isWhiteSpaceAt(s, p)) {
      p++; }
   return p; }

// Skips non-blanks (no-white space) in string s starting at position p.
function skipNonBlanks (s: string, p0: number) : number {
   const len = s.length;
   let p = p0;
   while (p < len && !isWhiteSpaceAt(s, p)) {
      p++; }
   return p; }

// Returns true if string s is blank (white space) from position p to the end.
function isRestOfStringBlank (s: string, p: number) : boolean {
   return skipBlanks(s, p) >= s.length; }

// Returns true if string s is blank (white space).
function isStringBlank (s: string) : boolean {
   return isRestOfStringBlank(s, 0); }
