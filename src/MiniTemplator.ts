import {ParsedTemplate} from "./MiniTemplatorParser.js";
import {assert, formatVariableValue, escapeHtml} from "./Utils.js";

// Thrown when `MiniTemplator.setVariable()` is called with a `variableName` that is not used within the template.
export class VariableNotDefinedError extends Error {
   public constructor (varName: string) {
      super(`Variable "${varName}" not used in template.`); }}

// Thrown when `MiniTemplator.addBlock()` is called with a `blockName` that is not defined within the template.
export class BlockNotDefinedError extends Error {
   public constructor (blockName: string) {
      super(`Block "${blockName}" not defined in template.`); }}

interface BlockDynTabRec {                                           // block dynamic data table record structure
   instances:                          number;                       // number of instances of this block
   firstBlockInstNo:                   number;                       // block instance no of first instance of this block or -1
   lastBlockInstNo:                    number;                       // block instance no of last instance of this block or -1
   currBlockInstNo:                    number; }                     // current block instance no, only used during generation of output file

interface BlockInstTabRec {                                          // block instance table record structure
   blockNo:                            number;                       // block number
   instanceLevel:                      number;                       // instance level of this block
      // InstanceLevel is an instance counter per block.
      // (In contrast to blockInstNo, which is an instance counter over the instances of all blocks.)
   parentInstLevel:                    number;                       // instance level of parent block
   nextBlockInstNo:                    number;                       // pointer to next instance of this block or -1
      // Forward chain for instances of same block.
   blockVarTab:                        string[]; }                   // block instance variable values

const enum ChunkKind {endOfBlock, variable, subBlock}

export class MiniTemplator {

   private template:                   ParsedTemplate;               // parsed template
   private varValuesTab:               string[];                     // current variable values
   private blockDynTab:                BlockDynTabRec[];             // dynamic block-specific values
   private blockInstTab:               BlockInstTabRec[];            // block instances table, indexed by blockInstNo
      // This table contains an entry for each block instance that has been added.

   public constructor (template: ParsedTemplate) {
      this.template = template;
      this.reset(); }

   /**
   * Resets the MiniTemplator object to the initial state.
   * All variable values are cleared and all added block instances are deleted.
   */
   public reset() {
      const varCount = this.template.varTab.length;
      if (!this.varValuesTab) {
         this.varValuesTab = new Array(varCount); }
      this.varValuesTab.fill("");
      const blockCount = this.template.blockTab.length;
      if (!this.blockDynTab) {
         this.blockDynTab = new Array(blockCount); }
      for (let blockNo = 0; blockNo < blockCount; blockNo++) {
         let bdtr = this.blockDynTab[blockNo];
         if (!bdtr) {
            bdtr = <BlockDynTabRec>{};
            this.blockDynTab[blockNo] = bdtr; }
         bdtr.instances = 0;
         bdtr.firstBlockInstNo = -1;
         bdtr.lastBlockInstNo = -1; }
      this.blockInstTab = []; }

   /**
   * Sets a template variable.
   *
   * For variables that are used in blocks, the variable value must be set before `addBlock()` is called.
   * Throws a `VariableNotDefinedError` when no variable with the specified name exists in the template.
   *
   * @param varName
   *   The name of the variable to be set.
   * @param varValue
   *   The new value of the variable. `undefined` and `null` are converted to an empty string.
   */
   public setVariable (varName: string, varValue: any) {
      const varNo = this.template.lookupVariableName(varName);
      if (varNo == -1) {
         throw new VariableNotDefinedError(varName); }
      this.varValuesTab[varNo] = formatVariableValue(varValue); }

   /**
   * Sets an optional template variable.
   *
   * If no variable with the specified name exists, the call is ignored.
   *
   * @param varName
   *   The name of the variable to be set.
   * @param varValue
   *   The new value of the variable. `undefined` and `null` are converted to an empty string.
   */
   public setVariableOpt (varName: string, varValue: any) {
      const varNo = this.template.lookupVariableName(varName);
      if (varNo == -1) {
         return; }
      this.varValuesTab[varNo] = formatVariableValue(varValue); }

   /**
   * Sets a template variable to an escaped value.
   *
   * Convenience method for: `setVariable(varName, escapeHtml(varValue))`
   */
   public setVariableEsc (varName: string, varValue: any) {
      this.setVariable(varName, escapeHtml(varValue)); }

   /**
   * Sets an optional template variable to an escaped value.
   *
   * Convenience method for: `setVariableOpt(varName, escapeHtml(var))</code>
   */
   public setVariableOptEsc (varName: string, varValue: any) {
      this.setVariableOpt(varName, escapeHtml(varValue)); }

   /**
   * Returns `true` if a variable with the specified name exists within the template.
   */
   public variableExists (vareName: string) {
      return this.template.lookupVariableName(vareName) != -1; }

   /**
   * Adds an instance of a template block.
   *
   * If the block contains variables, these variables must be set before the block is added.
   * If the block contains subblocks (nested blocks), the subblocks must be added before this block is added.
   * If multiple blocks exist with the specified name, an instance is added for each block occurrence.
   * Throws a BlockNotDefinedError when no block with the specified name exists in the template.
   */
   public addBlock (blockName: string) {
      const blockNo = this.template.lookupBlockName(blockName);
      if (blockNo == -1) {
         throw new BlockNotDefinedError(blockName); }
      this.addBlocksByNo(blockNo); }

   /**
   * Adds an instance of an optional template block.
   *
   * When no block with the specified name exists, the call has no effect.
   */
   public addBlockOpt (blockName: string) {
      const blockNo = this.template.lookupBlockName(blockName);
      this.addBlocksByNo(blockNo); }

   private addBlocksByNo (firstBlockNo: number) {
      let blockNo = firstBlockNo;
      while (blockNo != -1) {
         this.addBlockByNo(blockNo);
         blockNo = this.template.blockTab[blockNo].nextWithSameName; }}

   private addBlockByNo (blockNo: number) {
      const btr = this.template.blockTab[blockNo];
      const bdtr = this.blockDynTab[blockNo];
      const blockInstNo = this.blockInstTab.length;
      const bitr = <BlockInstTabRec>{};
      this.blockInstTab.push(bitr);
      if (bdtr.firstBlockInstNo == -1) {
         bdtr.firstBlockInstNo = blockInstNo; }
      if (bdtr.lastBlockInstNo != -1) {
         this.blockInstTab[bdtr.lastBlockInstNo].nextBlockInstNo = blockInstNo; }  // set forward pointer of chain
      bdtr.lastBlockInstNo = blockInstNo;
      bitr.blockNo = blockNo;
      bitr.instanceLevel = bdtr.instances++;
      if (btr.parentBlockNo == -1) {
         bitr.parentInstLevel = -1; }
       else {
         bitr.parentInstLevel = this.blockDynTab[btr.parentBlockNo].instances; }
      bitr.nextBlockInstNo = -1;
      const blockVarCnt = btr.blockVarNoToVarNoMap.length;
      if (blockVarCnt > 0) {
         bitr.blockVarTab = new Array(blockVarCnt);
         for (let blockVarNo = 0; blockVarNo < blockVarCnt; blockVarNo++) {       // copy instance variables for this block
            const varNo = btr.blockVarNoToVarNoMap[blockVarNo];
            bitr.blockVarTab[blockVarNo] = this.varValuesTab[varNo]; }}}

   /**
   * Returns `true` when a block with the specified name exists in the template.
   */
   public blockExists (blockName: string) : boolean {
      return this.template.lookupBlockName(blockName) != -1; }

   //--- Output generation ----------------------------------------------

   /**
   * Generates the output page and returns it as a string.
   */
   public generateOutputString() : string {
      const out = this.generateOutputArray();
      return out.join(""); }

   /**
   * Generates the output page and returns it as an array of strings.
   */
   public generateOutputArray() : string[] {
      if (this.blockDynTab[0].instances == 0) {
         this.addBlockByNo(0); }                                     // add main block
      for (const bdtr of this.blockDynTab) {
         bdtr.currBlockInstNo = bdtr.firstBlockInstNo; }
      const out: string[] = [];
      this.writeBlockInstances(out, 0, -1);
      return out; }

   // Writes all instances of a block that are contained within a specific parent block instance.
   // Called recursively.
   private writeBlockInstances (out: string[], blockNo: number, parentInstLevel: number) {
      const bdtr = this.blockDynTab[blockNo];
      while (true) {
         const blockInstNo = bdtr.currBlockInstNo;
         if (blockInstNo == -1) {
            break; }
         const bitr = this.blockInstTab[blockInstNo];
         assert(bitr.parentInstLevel >= parentInstLevel);
         if (bitr.parentInstLevel > parentInstLevel) {
            break; }
         this.writeBlockInstance(out, blockInstNo);
         bdtr.currBlockInstNo = bitr.nextBlockInstNo; }}

   private writeBlockInstance (out: string[], blockInstNo: number) {
      const varRefTab = this.template.varRefTab;
      const blockTab = this.template.blockTab;
      const bitr = this.blockInstTab[blockInstNo];
      const blockNo = bitr.blockNo;
      const btr = this.template.blockTab[blockNo];
      let tPos = btr.tPosContentsBegin;
      let subBlockNo = blockNo + 1;
      let varRefNo = btr.firstVarRefNo;
      while (true) {
         let tPos2 = btr.tPosContentsEnd;
         let kind = ChunkKind.endOfBlock;
         if (varRefNo != -1 && varRefNo < varRefTab.length) {        // check for variable reference
            const vrtr = varRefTab[varRefNo];
            if (vrtr.tPosBegin < tPos) {
               varRefNo++;
               continue; }
            if (vrtr.tPosBegin < tPos2) {
               tPos2 = vrtr.tPosBegin;
               kind = ChunkKind.variable; }}
         if (subBlockNo < blockTab.length) {                         // check for subblock
            const subBtr = blockTab[subBlockNo];
            if (subBtr.tPosBegin < tPos) {
               subBlockNo++;
               continue; }
            if (subBtr.tPosBegin < tPos2) {
               tPos2 = subBtr.tPosBegin;
               kind = ChunkKind.subBlock; }}
         if (tPos2 > tPos) {
            out.push(this.template.templateText.substring(tPos, tPos2)); }
         switch (kind) {
            case ChunkKind.endOfBlock: {
               return; }
            case ChunkKind.variable: {
               const vrtr = varRefTab[varRefNo];
               assert(vrtr.blockNo == blockNo);
               const varValue = bitr.blockVarTab[vrtr.blockVarNo];
               if (varValue) {
                  out.push(varValue); }
               tPos = vrtr.tPosEnd;
               varRefNo++;
               break; }
            case ChunkKind.subBlock: {
               const subBtr = blockTab[subBlockNo];
               assert(subBtr.parentBlockNo == blockNo);
               this.writeBlockInstances(out, subBlockNo, bitr.instanceLevel);    // recursive call
               tPos = subBtr.tPosEnd;
               subBlockNo++;
               break; }}}}}
