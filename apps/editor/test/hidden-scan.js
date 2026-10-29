// Ultron round 7 NT1: find code hidden after a same-line // comment. acorn hands us every real // comment (never one inside
// a string, regex or template); each tail of its text that starts at a word boundary is parsed on its own, and the comment
// is flagged when a tail runs to the end of the comment as nothing but statements: calls, member assignments,
// ;-terminated assignments / returns, if / for / while / throw / declarations. Prose like "autosave (N3)" doesn't parse
// to the end, or is a lone call with no semicolon, so it is not flagged.
const acorn = require('acorn');
const OPTS = { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
function codeExpr(x, semi) {
  switch (x && x.type) {
    case 'CallExpression': case 'NewExpression': return /^(Identifier|MemberExpression|CallExpression)$/.test(x.callee.type);
    case 'AssignmentExpression': return x.left.type === 'MemberExpression' || semi;
    case 'UpdateExpression': return true;
    case 'UnaryExpression': return x.operator === 'delete'; // R7b: `delete o.x;`
    case 'ConditionalExpression': return semi && codeExpr(x.consequent, semi) && codeExpr(x.alternate, semi); // `c ? a() : b();`
    case 'AwaitExpression': return codeExpr(x.argument, true);
    case 'SequenceExpression': return x.expressions.every(e => codeExpr(e, semi));
    case 'ChainExpression': return codeExpr(x.expression, semi);
    default: return false;
  }
}
const codeStmt = (n, semi) => n.type === 'ExpressionStatement' ? codeExpr(n.expression, semi)
  : /^(If|For|ForOf|ForIn|While|DoWhile|Throw|Try|Switch)Statement$|Declaration$/.test(n.type) || (n.type === 'ReturnStatement' && semi);
/** R9-NT1: a tail parsed as a script, else as a module (so a commented-out `import x from "y";` parses), else null. */
function parseTail(s) {
  for (const sourceType of ['script', 'module']) { try { return acorn.parse(s, { ...OPTS, sourceType }); } catch (e) { /* not this kind */ } }
  return null;
}
/** The code-looking tail of one // comment's text, or null. */
function hiddenCode(text) {
  // R7b: URLs are blanked out first (`see https://x.test/a?b=c;` is prose). R8-NT1: with URLs gone, a tail may start at any
  // word boundary again (after any non-identifier character), so code glued to punctuation is caught: `keep,render();`,
  // `OSH-22:render();`, `(OSH-22)nm.textContent = …;`, `fix—nm.title = t;`
  const t = text.replace(/\b[a-z][\w+.-]*:\/\/\S*/gi, m => ' '.repeat(m.length)).replace(/\s+$/, '');
  for (let i = 0; i < t.length; i++) {
    if ((i && /[\w$]/.test(t[i - 1])) || !/[\w$(]/.test(t[i])) continue;
    const s = t.slice(i), p = parseTail(s); if (!p) continue;
    const semi = /;\s*$/.test(s), b = p.body;
    const loneCall = b.length === 1 && b[0].type === 'ExpressionStatement' && b[0].expression.type === 'CallExpression' && b[0].expression.callee.type === 'Identifier' && !semi;
    if (b.length && !loneCall && b.every(n => codeStmt(n, semi))) return s;
  }
  return null;
}
/** [{line, code}] for every // comment in a JS source (an ES module) that hides code. */
function scanSource(src) {
  const hits = [];
  acorn.parse(src, { ...OPTS, sourceType: 'module', locations: true, onComment: (block, text, start, end, loc) => { if (!block) { const c = hiddenCode(text); if (c) hits.push({ line: loc.line, code: c }); } } });
  return hits;
}
module.exports = { hiddenCode, scanSource };
