#!/usr/bin/env node
import './safe_exit.mjs'; // first: no exit-time SIGSEGV with system CAs on (preload_system_ca.mjs)
import { initDb } from './local_db.mjs';

console.log(JSON.stringify(initDb(), null, 2));
