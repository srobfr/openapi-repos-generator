#!/bin/env -S deno run -A --unsafely-ignore-certificate-errors

// Usage :
// ouputPath=/path/to/src/api url="https://your-project.localhost/docs.jsonopenapi" ./index.ts -a

import { load, processCmdArgs } from "npm:@srob/files@0.0.12";
import { analyze } from "./analyzer.ts";

const context = await analyze({
  /** The openApi doc URL */
  apiDocUrl: Deno.env.get("url") ?? (() => {
    throw new Error(`No url specified. Try :
ouputPath=/path/to/src/api url="https://your-project.localhost/docs.jsonopenapi" ./index.ts`);
  })(),

  /** The path for the base output folder */
  ouputPath: Deno.env.get("outputPath") ?? `/tmp/src/api`,
  importPrefix: Deno.env.get("importPrefix") ?? `src/api`,
  operationsSelector: /./,

  apiDoc: {},
  operations: [],
  schemasByName: {},
  repositoriesCode: {},
  schemasCode: {},
});

for (
  const [path, code] of Object.entries({
    ...(context.schemasCode),
    ...(context.repositoriesCode),
  })
) {
  const file = await load(path);
  file.content = code;
}

await processCmdArgs();
