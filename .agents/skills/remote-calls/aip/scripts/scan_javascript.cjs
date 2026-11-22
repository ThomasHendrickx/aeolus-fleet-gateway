// AST-backed ESM scan. Requires acorn in the fixture/repository dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = process.argv[2];
const config = JSON.parse(process.argv[3]);
const result = {violations: [], missingTimeouts: [], unsupported: []};
const unsupported = (node, reason) => result.unsupported.push({path: filename, line: node?.loc?.start.line, reason});
try {
  const requireRepo = createRequire(path.resolve(filename));
  const acorn = requireRepo('acorn');
  const tree = acorn.parse(fs.readFileSync(filename, 'utf8'), {ecmaVersion:'latest', sourceType:'module', locations:true});
  const aliases = new Map();
  function walk(node, fn) {
    if (!node || typeof node !== 'object') return;
    if (node.type) fn(node);
    for (const [key,value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(value)) value.forEach(v => walk(v,fn));
      else if (value && typeof value === 'object') walk(value,fn);
    }
  }
  walk(tree, node => {
    if(node.type === 'ImportDeclaration') {
      const module = node.source.value;
      for(const spec of node.specifiers) aliases.set(spec.local.name, module);
      if(config.domain && module === config.library) result.violations.push({path:filename,line:node.loc.start.line,module});
    }
  });
  const moduleFor = node => node?.type === 'Identifier' ? aliases.get(node.name) : node?.type === 'MemberExpression' ? moduleFor(node.object) : undefined;
  walk(tree, node => {
    if(node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee.name === 'require')) unsupported(node,'dynamic/CommonJS imports require module resolution');
    if(node.type === 'VariableDeclarator' && moduleFor(node.init)) unsupported(node,'assigned client alias requires flow analysis');
    if(node.type === 'VariableDeclarator' && node.init?.type === 'NewExpression' && moduleFor(node.init.callee)) unsupported(node,'client instance requires flow/type analysis');
    if(node.type === 'CallExpression') {
      const module = moduleFor(node.callee);
      const client = config.clients.find(c => c.module === module);
      if(!client) return;
      const options = node.arguments.filter(n => n.type === 'ObjectExpression');
      if(!options.length && node.arguments.some(n => n.type === 'SpreadElement' || n.type === 'Identifier')) unsupported(node,'nonliteral options may contain timeout; inspect manually');
      else if(options.some(n => n.properties.some(p => p.type === 'SpreadElement' || p.computed))) unsupported(node,'spread/computed options require runtime resolution');
      else if(!options.some(n => n.properties.some(p => (p.key.name || p.key.value) === client.timeoutOption))) result.missingTimeouts.push({path:filename,line:node.loc.start.line,module,timeoutOption:client.timeoutOption});
    }
  });
} catch(error) { unsupported(null, String(error)); }
console.log(JSON.stringify(result));
