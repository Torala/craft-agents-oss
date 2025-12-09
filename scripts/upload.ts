import { S3Client, DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

const BUCKET = 'craft-tui-versions';
if (!process.env.S3_VERSIONS_BUCKET_ENDPOINT || !process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID || !process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials');
  process.exit(1);
}

const isLatest = process.argv.includes('--latest');
const scriptDir = import.meta.dir;
const repoRoot = dirname(scriptDir);
const buildDir = join(repoRoot, '.build');
const manifestPath = join(buildDir, 'manifest.json');
console.log(`Manifest path: ${buildDir}`);

// Read manifest to get version
let manifest: { version: string };
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (error) {
  console.error('Failed to read manifest.json from .build directory');
  console.error('Run the build script first: bun run scripts/build.ts <version>');
  process.exit(1);
}

const version = manifest.version;
console.log(`Uploading version ${version}...`);
if (isLatest) {
  console.log('Will also update /latest folder');
}
console.log('');

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_VERSIONS_BUCKET_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_VERSIONS_BUCKET_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY,
  },
});


async function deleteFolder(prefix: string) {
  console.log(`Deleting ${prefix}...`);
  // List all objects with the prefix
  const listResponse = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));

  if (!listResponse.Contents || listResponse.Contents.length === 0) {
    console.log(`  No existing files found`);
    return;
  }

  // Delete all objects
  const deleteResponse = await s3.send(new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: {
      Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
    },
  }));

  console.log(`  Deleted ${deleteResponse.Deleted?.length || 0} files`);
}

async function uploadFolder(prefix: string) {
  console.log(`Uploading to ${prefix}...`);
  
  const files = readdirSync(buildDir);
  
  for (const file of files) {
    const filePath = join(buildDir, file);
    const content = readFileSync(filePath);
    const key = `${prefix}${file}`;
    
    // Determine content type
    let contentType = 'application/octet-stream';
    if (file.endsWith('.json')) {
      contentType = 'application/json';
    }

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: content,
      ContentType: contentType,
    }));

    console.log(`  ✓ ${key} (${(content.length / 1024 / 1024).toFixed(2)} MB)`);
  }
}

try {
  // Upload to version folder
  const versionPrefix = `${version}/`;
  await deleteFolder(versionPrefix);
  await uploadFolder(versionPrefix);
  console.log('');

  // If --latest, also update latest folder
  if (isLatest) {
    const latestPrefix = 'latest';
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: latestPrefix,
      Body: JSON.stringify({ version }),
      ContentType: 'application/json',
    }));
  }

  console.log('Upload complete!');
} catch (error) {
  console.error('Upload failed:', error);
  process.exit(1);
}
