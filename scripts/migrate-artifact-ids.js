#!/usr/bin/env node
import { ArtifactStore } from "../src/artifact/store.js";
import { loadConfig } from "../src/config.js";

const store = new ArtifactStore(loadConfig());
await store.initialize();
const migrations = await store.migrateLegacyArtifacts();

if (migrations.length === 0) {
  console.log("No legacy artifact identifiers found.");
} else {
  console.log(`Migrated ${migrations.length} artifact identifier${migrations.length === 1 ? "" : "s"}:`);
  for (const migration of migrations) console.log(`${migration.from} -> ${migration.to}`);
}
