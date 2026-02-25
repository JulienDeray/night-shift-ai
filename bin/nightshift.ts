#!/usr/bin/env node

import { loadEnvFile } from "../src/utils/env-loader.js";
import { program } from "../src/cli/index.js";

loadEnvFile();
program.parse();
