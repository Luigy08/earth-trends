import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = new URL('../functions/.env.local', import.meta.url);
if (!existsSync(file)) throw new Error('Primero crea functions/.env.local con las credenciales.');
process.loadEnvFile(file);
// "earthdata" uploads the NASA Earthdata Login credentials used by the Giovanni provider.
const SECRET_SETS = { meteomatics: ['METEOMATICS_USERNAME', 'METEOMATICS_PASSWORD'], earthdata: ['EARTHDATA_USERNAME', 'EARTHDATA_PASSWORD'] };
const account = process.argv[2];
const names = SECRET_SETS[process.argv[3] ?? 'meteomatics'];
if (!account || !names) throw new Error('Uso: node scripts/configure-meteomatics.mjs correo-de-la-cuenta-de-despliegue [meteomatics|earthdata]');
for (const name of names) {
  if (!process.env[name]?.trim()) throw new Error(`Falta ${name}.`);
}
for (const name of names) {
  const result = spawnSync('npx', ['--yes', 'firebase-tools', 'functions:secrets:set', name,
    '--data-file', '/dev/stdin', '--project', 'earth-trend-detective',
    '--account', account, '--non-interactive'], {
    input: process.env[name], encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`No se pudo guardar ${name} en Secret Manager. Revisa los permisos de la cuenta de despliegue.`);
  console.log(`${name}: guardado en Secret Manager.`);
}
console.log('Provider endpoints use Secret Manager in production by default; redeploy Functions to bind the latest secret versions.');
