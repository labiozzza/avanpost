import { getV2ProjectRoot, loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';
import { V2DatabaseError } from '../database/identity.js';
import { assertLoopbackPortAvailable, assertSupportedNode, getAvailableDiskBytes } from './doctor-checks.js';

loadV2Env();

try {
  const config = loadV2Config();
  assertSupportedNode(process.versions.node);
  const portChecks = [
    assertLoopbackPortAvailable(config.port, config.bindHost),
    assertLoopbackPortAvailable(config.clientPort, config.bindHost),
    assertLoopbackPortAvailable(config.handoffPort, '127.0.0.1')
  ];
  if (config.lanEnabled && !['127.0.0.1', 'localhost', '::1'].includes(config.bindHost)) {
    portChecks.push(assertLoopbackPortAvailable(config.loopbackClientPort, '127.0.0.1'));
  }
  await Promise.all(portChecks);
  const freeDiskBytes = await getAvailableDiskBytes(getV2ProjectRoot());
  const developmentClient = await connectVerifiedV2Database(config, 'development');
  try {
    const testClient = await connectVerifiedV2Database(config, 'test');
    try {
    console.log(
      JSON.stringify({
        status: 'ready',
        operation: 'development-and-test',
        databases: [
          config.database.development.databaseName,
          config.database.test.databaseName
        ],
        hostMode: config.database.development.mode,
        freeDiskBytes
      })
    );
    } finally {
      await testClient.end();
    }
  } finally {
    await developmentClient.end();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'V2 doctor failed safely.';
  const code = error instanceof V2DatabaseError
    ? error.code
    : message.startsWith('V2_')
      ? message.split(':', 1)[0]
      : 'V2_DOCTOR_FAILED';
  console.error(JSON.stringify({ status: 'blocked', code, message }));
  process.exitCode = 1;
}
