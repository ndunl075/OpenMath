#!/usr/bin/env node
import { register } from "node:module";

register(new URL("./ts-hook.mjs", import.meta.url));

const { main } = await import("../src/cli.ts");
process.exitCode = await main(process.argv.slice(2));
