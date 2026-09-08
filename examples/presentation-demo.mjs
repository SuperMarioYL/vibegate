import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scanReadiness} from '../dist/scan/readiness.js';
import {scanLicense} from '../dist/scan/license.js';
import {runSandbox} from '../dist/run/sandbox.js';
import {buildVerdict} from '../dist/report/verdict.js';
import {DEFAULT_CONFIG} from '../dist/config.js';
const dir=await mkdtemp(join(tmpdir(),'vibegate-demo-'));
try {
  const pkg={name:'presentation-fixture',version:'1.0.0',license:'MIT',scripts:{start:'node index.js'}};
  await writeFile(join(dir,'package.json'),JSON.stringify(pkg));
  await writeFile(join(dir,'package-lock.json'),JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,packages:{'':pkg}}));
  await writeFile(join(dir,'.gitignore'),'node_modules/\n');
  const config={...DEFAULT_CONFIG,timeoutMs:3000,writeReport:false};
  for (const stage of ['before','after']) {
    await writeFile(join(dir,'index.js'),stage==='before'?'process.exit(1);\n':'process.exit(0);\n');
    if(stage==='after') await writeFile(join(dir,'README.md'),'# Fixture\nRun npm start; it exits successfully.\n');
    const checks=[await scanReadiness(dir,config),await scanLicense(dir,config),await runSandbox(dir,config)];
    const report=buildVerdict({path:dir,runtime:'node'},checks);
    console.log(JSON.stringify({stage,verdict:report.verdict,checks:checks.map(c=>({id:c.id,status:c.status,codes:c.findings.map(f=>f.code).filter(Boolean)}))},null,2));
  }
} finally {await rm(dir,{recursive:true,force:true});}
