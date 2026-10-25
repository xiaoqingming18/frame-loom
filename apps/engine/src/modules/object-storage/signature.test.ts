import { expect, it } from 'vitest';
import { AwsV4Signer } from 'aws4fetch';

it('匹配 AWS SDK 公布的固定 SigV4 签名向量', async () => {
  // 来源：https://github.com/aws/aws-sdk-js/blob/master/test/signers/v4.spec.js
  const signer = new AwsV4Signer({
    url: 'https://localhost/',
    method: 'POST',
    service: 'dynamodb',
    region: 'region',
    accessKeyId: 'akid',
    secretAccessKey: 'secret',
    sessionToken: 'session',
    datetime: new Date(1935346573456).toISOString().replace(/[:-]|\.\d{3}/g, ''),
    headers: {
      'X-Amz-Content-Sha256': '3128b8d4f3108b3e1677a38eb468d1c6dec926a58eaea235d034b9c71c3864d4',
      'X-Amz-Target': 'DynamoDB_20111205.ListTables',
      'X-Amz-User-Agent': 'aws-sdk-js/0.1',
    },
  });
  expect(await signer.signature()).toBe(
    '31fac5ed29db737fbcafac527470ca6d9283283197c5e6e94ea40ddcec14a9c1',
  );
});
