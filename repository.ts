import { buildImports } from "./imports.ts";
import { addImportBy } from "./imports.ts";
import { Context, Operation, Parameter } from "./types.ts";
import {
  importFromZodSchemaName,
  lcFirst,
  plural,
  toJsIdentifier,
  toJsObjKey,
} from "./utils.ts";

const buildPath = (path: string, context: Context, operation?: Operation): string => {
  const queryParamsNames = (operation?.parameters ?? [])
    .filter((parameter) => parameter.in === "query")
    .map((parameter) =>
      ` ${
        parameter.name.match(/^[a-z]\w*$/i)
          ? parameter.name
          : `${JSON.stringify(toJsObjKey(parameter.name))}: ${parameter.tsName}`
      }`
    );

  return `\`${
    path.replaceAll(/\{(\w+)\}/g, (_, m) => `\${${toJsIdentifier(m)}}`)
  }${
    queryParamsNames.length > 0
      ? `\${${
        addImportBy(operation, "serializeSearchParams", `${context.importPrefix}/client`)
      }serializeSearchParams({${queryParamsNames.join(",")} })}`
      : ""
  }\``;
};

const buildReadHookFnBody = (operation: Operation, context: Context): string => {
  const { responseSchema, queryKey } = operation;
  addImportBy(operation, "useApiQuery", "src/api/useApiQuery");
  addImportBy(
    operation,
    responseSchema!.zodName,
    `src/api/schemas/${responseSchema!.zodName}`,
  );

  return `return useApiQuery({
    queryKey: [${queryKey.join(", ")}],
    path: ${buildPath(operation.path, context)},
    schema: ${responseSchema!.zodName},
  });`;
};

const buildCreateUpdateHookFnBody = (operation: Operation, context: Context): string => {
  const { requestSchema, method, queryKey } = operation;
  addImportBy(operation, "useQueryClient", "@tanstack/react-query");
  addImportBy(operation, "createOrUpdate", "src/repositories/api");
  addImportBy(operation, "useApiMutation", "src/api/useApiMutation", true);

  return `const queryClient = useQueryClient();
  return useApiMutation({
    mutationKey: [${queryKey.join(", ")}],
    mutationFn: async (${
    requestSchema
      ? `data: ${requestSchema.name}${
        addImportBy(
          operation,
          requestSchema.name,
          `src/api/schemas/${requestSchema.zodName}`,
        )
      }`
      : ""
  }) => createOrUpdate("${method}", ${buildPath(operation.path, context)}${
    requestSchema ? `, data` : ""
  }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [${queryKey[0]}] });
    },
    form,
  });`;
};

const buildDeleteHookFnBody = (operation: Operation, context: Context): string => {
  addImportBy(operation, "useQueryClient", "@tanstack/react-query");
  addImportBy(operation, "deleteResource", "src/repositories/api");
  addImportBy(operation, "useApiMutation", "src/api/useApiMutation", true);

  const { queryKey } = operation;
  return `const queryClient = useQueryClient();
  return useApiMutation({
    mutationKey: [${queryKey.join(", ")}],
    mutationFn: async (): Promise<void> => deleteResource(${
    buildPath(operation.path, context)
  }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [${queryKey[0]}] });
    },
  });`;
};

const buildListHookFnBody = (operation: Operation, context: Context): string => {
  const { queryKey, responseSchema } = operation;
  addImportBy(operation, "useApiCollectionQuery", "src/api/useApiQuery");
  addImportBy(
    operation,
    responseSchema!.zodName,
    `src/api/schemas/${responseSchema!.zodName}`,
  );

  return `return useApiCollectionQuery({
    queryKey: [${queryKey.join(", ")}],
    path: ${buildPath(operation.path, context, operation)},
    schema: ${responseSchema!.zodName},
  });`;
};

const buildHookFnBody = (operation: Operation, context: Context): string => {
  const { entityName, parameters, hook: { type } } = operation;
  operation.queryKey = [
    `"${plural(lcFirst(entityName))}"`,
    ...(parameters ?? []).map((param: Parameter) => param.tsName),
  ];

  if (type === "create" || type === "update") {
    return buildCreateUpdateHookFnBody(operation, context);
  }
  if (type === "read") return buildReadHookFnBody(operation, context);
  if (type === "delete") return buildDeleteHookFnBody(operation, context);
  if (type === "list") return buildListHookFnBody(operation, context);

  console.error(operation);
  throw new Error("Unhandled hook type");
};

const buildRepositoryCode = (
  operations: Array<Operation>,
  context: Context,
): string => {
  const hooks: Array<string> = operations.map((operation) => {
    const { method, path, hook, parameters, requestSchema } = operation;
    const { name: hookName, desc } = hook;
    const args = [
      ...(parameters ?? []).map((param: Parameter) => param.hookArgStr),
      ...(requestSchema
        ? [
          `form: ${
            addImportBy(operation, "UseFormReturn", "react-hook-form")
          }UseFormReturn<${requestSchema.name}>`,
        ]
        : []),
    ].join(", ");

    const body = `/**
 * ${desc}
 * Endpoint: ${method.toUpperCase()} ${path}
 * API Platform id : ${operation.operationId}
 */
export function ${hookName}(${args}) {
  ${buildHookFnBody(operation, context)}
}`;

    if (operation.cantGenerateReason) {
      return `TODO ${operation.cantGenerateReason}\n${body}`.replaceAll(
        /^|\n/g,
        (m) => `${m[0] ?? ""}// `,
      );
    }

    return body;
  });

  return `${buildImports(operations)}

// 🤖 This file has been autogenerated from ${context.apiDocUrl} 🤖

${hooks.join("\n\n")}\n`;
};

export function buildRepositoriesCode(context: Context) {
  const operationsByEntityName: { [entityName: string]: Array<Operation> } = {};
  for (const operation of context.operations) {
    operationsByEntityName[operation.entityName] ??= [];
    operationsByEntityName[operation.entityName].push(operation);
  }

  const repositoriesCodesByPath = Object.fromEntries(
    Object.entries(operationsByEntityName).map(([entityName, operations]) => {
      const path =
        `${context.outputPath}/repositories/${entityName}Repository.ts`;
      const code = buildRepositoryCode(operations, context);
      return [path, code];
    }),
  );

  context.repositoriesCode = repositoriesCodesByPath;
}
