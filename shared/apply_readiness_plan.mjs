#!/usr/bin/env node
// Preferred entrypoint. apply_capacity_plan.mjs remains as a compatibility alias.
import './safe_exit.mjs'; // first: no exit-time SIGSEGV with system CAs on (preload_system_ca.mjs)
import './apply_capacity_plan.mjs';
