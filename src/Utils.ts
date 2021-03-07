// General utilities.

export function assert (cond: boolean) : asserts cond {
   if (!cond) {
      throw new Error("Assertion failed."); }}

// Formats a template variable value.
// `undefined` and `null` are converted to an empty string.
export function formatVariableValue (v: any) : string {
   if (typeof v === "string") {
      return v; }
   if (v === undefined || v === null) {
      return ""; }
   return v.toString(); }                                            // eslint-disable-line

// Escapes special HTML characters within a string.
// Replaces the characters &lt;, &gt;, &amp;, ' and " by their corresponding HTML character entity codes.
// `undefined` and `null` are converted to an empty string.
export function escapeHtml (v: any) : string {
   const s = formatVariableValue(v);
   let out = "";
   let p2 = 0;
   for (let p = 0; p < s.length; p++) {
      let r: string;
      switch (s.charCodeAt(p)) {
         case 34: r = "&quot;"; break;  // "
         case 38: r = "&amp;" ; break;  // &
         case 39: r = "&#39;" ; break;  // '
         case 60: r = '&lt;'  ; break;  // <
         case 62: r = '&gt;'  ; break;  // >
         default: continue; }
      if (p2 < p) {
         out += s.substring(p2, p); }
      out += r;
      p2 = p + 1; }
   if (p2 == 0) {
      return s; }
   if (p2 < s.length) {
      out += s.substring(p2); }
   return out; }
