// deno-lint-ignore-file no-cond-assign
import { analyzeOpenApiSchema } from "./schema.ts";
import { Context, Operation, Parameter } from "./types.ts";
import { pascalCase, singular, toJsIdentifier, ucFirst } from "./utils.ts";

const isCollection = (
  operation: Operation,
) => (operation.responses["200"]?.content["application/ld+json"].schema
  .properties
  ?.["hydra:member"]?.type === "array");

type HookInfo = {
  type: "create" | "read" | "update" | "delete" | "list";
  name: string;
  desc: string;
};

const buildHookType = (operation: Operation) => {
  const { method, isCollection } = operation;
  return method === "get" && isCollection
    ? "list"
    : method === "post"
    ? "create"
    : method === "put"
    ? "update"
    : method === "delete"
    ? "delete"
    : "read";
};

/** Defines the hook name for the given operation */
const buildHookName = (operation: Operation, type: HookInfo["type"]) => {
  const { path, method } = operation;

  const nameFromPath = path
    .replaceAll(/\/(\w+s)\/\{\w+\}/g, (_, m) => "/" + singular(m)) // "/foos/{id}" => "/foo"
    .split(/[^\w]+/)
    .map(pascalCase)
    .join("");

  const nameFromPath2 = operation.method === "post"
    ? singular(nameFromPath) // POST /foos => Foo
    : nameFromPath;

  // SROB

  // const nameFromPath = (m = path.match(/^\/(\w+s)\/\{\w+\}$/)) // "/foos/{id}"
  //   ? pascalCase(singular(m[1])) // "Foo"
  //   : (m = path.match(/^\/(\w+)$/)) // "/foo"
  //   ? pascalCase(m[1]) // "Foo"
  //   : (m = path.match(/^\/(\w+s)\/\{\w+\}\/(\w+)$/)) // "/foos/{id}/bar"
  //   ? [singular(m[1]), m[2]].map(pascalCase).join("") // "FooBar"
  //   : (m = path.match(/^\/(\w+(?:\/\w+)+)$/)) // "/foo/bar"
  //   ? m.map(pascalCase).join("") // "FooBar"
  //   : (() => {
  //     console.error({ path });
  //     throw new Error("Unhandled path");
  //   })();

  return [
    "use",
    ucFirst(method),
    // (responseSchema?.name ?? entityName),
    nameFromPath2,

    ["read", "list"].includes(type) ? "Query" : "Mutation",
  ].join("");
};

const buildHookInfo = (operation: Operation): HookInfo => {
  const { method, path, summary, description } = operation;
  const type = buildHookType(operation);
  const name = buildHookName(operation, type);
  const desc = summary || description ||
    `${type} for the ${method.toUpperCase()} ${path} endpoint`;

  return { type, name, desc };
};

const parameterToHookArg = (parameter: Parameter): string => {
  const { tsName, schema, required } = parameter;

  return [
    tsName,
    required === false && schema.default === undefined ? "?" : "",
    ": ",
    schema.type?.enum
      ? schema.type.enum.map((value: any) => JSON.stringify(value)).join(
        " | ",
      )
      : schema.type === "string" && schema.enum
      ? `(${
        schema.enum.map((value: any) => JSON.stringify(value)).join(" | ")
      })`
      : schema.type === "string"
      ? "string"
      : schema.type === "integer" && schema.default
      ? `number = ${JSON.stringify(schema.default)}`
      : schema.type === "integer"
      ? "number"
      : schema.type === "boolean"
      ? "boolean"
      : (() => {
        console.debug({ parameter });
        throw new Error("To be implemented");
      })(),
  ].join("");
};

const parameterSortFn = (parameter: Parameter) => (
  parameter.required && parameter.schema.default === undefined
    ? 0
    : parameter.required
    ? 1
    : 2
);

const analyzeParameters = (operation: Operation) => {
  const { parameters } = operation;
  if (!parameters) return;

  parameters.sort((a: Parameter, b: Parameter) =>
    parameterSortFn(a) - parameterSortFn(b)
  );

  for (const parameter of parameters) {
    parameter.tsName = toJsIdentifier(parameter.name);
    parameter.hookArgStr = parameterToHookArg(parameter);
  }
};

const analyzeRequestBody = (operation: Operation, context: Context) => {
  const { requestBody } = operation;
  if (!requestBody) return;

  if (!requestBody.content?.["application/ld+json"]?.schema) {
    console.error(`Unhandled requestBody: `, requestBody);
    operation.cantGenerateReason =
      `No application/ld+json schema found for this endpoint's request body, 
I can't generate it properly (yet)!
Code provided below is probably buggy.`;
    return;
  }

  console.log(`Analyzing requestBody`, requestBody);
  operation.requestSchema = analyzeOpenApiSchema(
    requestBody.content?.["application/ld+json"]?.schema,
    requestBody.description,
    context,
  );
};

const analyzeResponseBody = (operation: Operation, context: Context) => {
  const responseBody = operation.responses["200"];
  if (!responseBody) return;

  if (!responseBody.content?.["application/ld+json"]?.schema) {
    console.log(`Unhandled responseBody: `, responseBody);
    // throw new Error(`To be implemented`);
    return;
  }

  operation.responseSchema = analyzeOpenApiSchema(
    responseBody.content?.["application/ld+json"]?.schema,
    responseBody.description,
    context,
  )!;
};

export function analyzeOperation(operation: Operation, context: Context) {
  console.log(
    `Processing operation ${operation.method.toUpperCase()} ${operation.path} (${operation.operationId})`,
  );

  operation.entityName = operation.tags[0];
  operation.isCollection = isCollection(operation);

  analyzeParameters(operation);
  analyzeRequestBody(operation, context);
  analyzeResponseBody(operation, context);

  operation.hook = buildHookInfo(operation);
}
