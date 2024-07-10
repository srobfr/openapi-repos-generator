import { analyzeOperation } from "./operation.ts";
import { buildRepositoriesCode } from "./repository.ts";
import { buildSchemasCode } from "./schema.ts";
import { Context, Operation } from "./types.ts";

async function fetchApiDoc(context: Context) {
  context.apiDoc = await (await fetch(context.apiDocUrl, {
    headers: new Headers({
      "Accept": "application/vnd.openapi+json",
    }),
  })).json();
}

function filterOperations(context: Context) {
  const operations: Array<Operation> = context.operations = [];
  for (const [path, pathInfo] of Object.entries(context.apiDoc.paths)) {
    const { parameters: _, ...methods } = pathInfo as Record<string, any>;

    for (const [method, opDoc] of Object.entries(methods)) {
      if (!opDoc.operationId.match(context.operationsSelector)) continue;
      opDoc.method = method;
      opDoc.path = path;
      operations.push(opDoc);
    }
  }
}

function analyzeOperations(context: Context) {
  for (const operation of context.operations) {
    analyzeOperation(operation, context);
  }
}

export async function analyze(context: Context) {
  
  await fetchApiDoc(context);
  filterOperations(context);
  analyzeOperations(context);
  buildRepositoriesCode(context);
  buildSchemasCode(context);

  return context;
}
