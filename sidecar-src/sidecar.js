#!/usr/bin/env node
// Auto-generated wrapper: runs sidecar.ts via tsx
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('tsx', pathToFileURL('./'));
import('./sidecar.ts');
