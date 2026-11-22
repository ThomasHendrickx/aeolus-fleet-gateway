import { parse } from 'acorn';
import { readdirSync, readFileSync } from 'node:fs';
function files(dir) {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
const violations=[];
for(const f of files('src/core').filter(f=>f.endsWith('.js'))) {
 const ast=parse(readFileSync(f,'utf8'),{ecmaVersion:'latest',sourceType:'module'});
 for(const n of ast.body) if(n.type==='ImportDeclaration' && (n.source.value==='cockatiel'||n.source.value.includes('/adapters/'))) violations.push(f+': '+n.source.value);
}
if(violations.length) {console.error(violations.join('\n'));process.exit(1);}
