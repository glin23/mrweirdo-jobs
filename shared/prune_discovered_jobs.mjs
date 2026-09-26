#!/usr/bin/env node
// Preferred entrypoint. prune_job_pool.mjs remains as a compatibility alias.
import './safe_exit.mjs'; // first: no exit-time SIGSEGV with system CAs on (preload_system_ca.mjs)
import './prune_job_pool.mjs';
