# MiniTemplator - JavaScript Version

MiniTemplator is a compact, optimized template engine primarily used for generating HTML output.

## Template syntax

Variables:
<pre><code>${<i>variableName</i>}
</code></pre>

Blocks:
<pre><code>&lt;!-- $beginBlock <i>blockName</i> -->
  <i>... block content ...</i>
&lt;!-- $endBlock <i>blockName</i> -->
</code></pre>

Conditional statements:
<pre><code>&lt;!-- $if <i>condExpr</i> -->
  ...
&lt;!-- $elseIf <i>condExpr</i> -->
  ...
&lt;!-- $else -->
  ...
&lt;!-- $endIf -->
</code></pre>

Include a subtemplate:
<pre><code>&lt;!-- $include <i>fileName</i> -->
</code></pre>

## Principles

- Blocks can be nested.
- Subtemplates can include other subtemplates.
- Conditions are JavaScript expressions that use condition variables.

### Phases

There are two phases when using MiniTemplator templates.

#### Phase 1: Loading, parsing and caching

When a template is parsed, condition expressions are evaluated, conditional statements are resolved and subtemplates are included.
A template is normally loaded and parsed only once and then used many times.
A parsed template can be cached in memory for later re-use.

#### Phase 2: Output document buildup

In the second phase, template variables are set and blocks are added.
When the document buildup is complete, everything is merged into a HTML string, which is the output of the template engine.

### Variables

There are two kinds of variables.

#### Condition variables

Condition variables are used in `$if` and `$elseIf` statements.

- Condition variables are used at the time a template is loaded and parsed.
- For each set of condition variable values, a separate parsed template object is cached.

#### Template variables

Template variables are used to place content into the template.

- Template variables are used when applying a parsed template to generate output.
- When a template variable is used within a block, it must be set before the `addBlock()` method for the block is called.
- The values `undefined` and `null` are converted into an empty string.

### Short form for conditional statements

When the `shortFormEnabled` option is set to `true`, the following alternative form can be used for conditional statements:

<pre><code>&lt;$? <i>condExpr</i>>
  ... <i>content for "if" case</> ...
&lt;$: <i>condExpr</i>>
  ... <i>content for "elseIf" case</i> ...
&lt;$:>
  ... <i>content for "else" case</i> ...
&lt;$/?>
</code></pre>

Example:
<pre><code>&lt;$?de> Hallo Welt!
&lt;$:fr> Bonjour le monde!
&lt;$:it> Ciao mondo!
&lt;$:  > Hello world!
&lt;$/?>
</code></pre>
