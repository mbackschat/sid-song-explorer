import {execFile} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execute = promisify(execFile);

test('engine bundle metadata replaces protected artifacts without changing runtime bytes', async () => {
  await execute('python3', ['-B', fileURLToPath(new URL('./engine_bundle_test.py', import.meta.url))], {timeout: 10000});
});
