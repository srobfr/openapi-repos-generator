import { addImportBy, buildImports } from "./imports.ts";
import { Context, Operation, Parameter } from "./types.ts";
import { lcFirst, plural, toJsIdentifier, toJsObjKey } from "./utils.ts";

const buildPath = (
  path: string,
  context: Context,
  operation?: Operation,
): string => {
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
        addImportBy(
          operation,
          "serializeSearchParams",
          `${context.importPrefix}/client`,
        )
      }serializeSearchParams({${queryParamsNames.join(",")} })}`
      : ""
  }\``;
};

const buildReadHookFnBody = (
  operation: Operation,
  context: Context,
): string => {
  const { responseSchema, queryKey } = operation;
  if (!responseSchema) {
    console.log({ operation }); // SROB
  }

  addImportBy(operation, "useApiQuery", `${context.importPrefix}/client`);
  addImportBy(
    operation,
    responseSchema!.zodName,
    `${context.importPrefix}/schemas/${responseSchema!.zodName}`,
  );

  return `return useApiQuery({
    queryKey: [${queryKey.join(", ")}],
    path: ${buildPath(operation.path, context)},
    schema: ${responseSchema!.zodName},
    ...options,
  });`;
};

const buildCreateHookFnBody = (
  operation: Operation,
  context: Context,
): string => {
  const { requestSchema, queryKey } = operation;
  addImportBy(operation, "useQueryClient", "@tanstack/react-query");
  addImportBy(operation, "create", `${context.importPrefix}/client`);
  addImportBy(operation, "useApiMutation", `${context.importPrefix}/client`);

  return `const queryClient = useQueryClient();
  return useApiMutation({
    mutationKey: [${queryKey.join(", ")}],
    mutationFn: async (${
    requestSchema
      ? `data: ${requestSchema.name}${
        addImportBy(
          operation,
          requestSchema.name,
          `${context.importPrefix}/schemas/${requestSchema.zodName}`,
        )
      }`
      : ""
  }) => create(${buildPath(operation.path, context)}${
    requestSchema ? `, data` : ""
  }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [${queryKey[0]}] });
    },
    form,
    ...options,
  });`;
};

const buildUpdateHookFnBody = (
  operation: Operation,
  context: Context,
): string => {
  const { requestSchema, queryKey } = operation;
  addImportBy(operation, "useQueryClient", "@tanstack/react-query");
  addImportBy(operation, "update", `${context.importPrefix}/client`);
  addImportBy(operation, "useApiMutation", `${context.importPrefix}/client`);
  addImportBy(
    operation,
    "UseApiQueryOptions",
    `${context.importPrefix}/client`,
  );

  return `const queryClient = useQueryClient();
  return useApiMutation({
    mutationKey: [${queryKey.join(", ")}],
    mutationFn: async (${
    requestSchema
      ? `data: ${requestSchema.name}${
        addImportBy(
          operation,
          requestSchema.name,
          `${context.importPrefix}/schemas/${requestSchema.zodName}`,
        )
      }`
      : ""
  }) => update(${buildPath(operation.path, context)}${
    requestSchema ? `, data` : ""
  }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [${queryKey[0]}] });
    },
    form,
    ...options,
  });`;
};

const buildDeleteHookFnBody = (
  operation: Operation,
  context: Context,
): string => {
  addImportBy(operation, "useQueryClient", "@tanstack/react-query");
  addImportBy(operation, "delete_", `${context.importPrefix}/client`);
  addImportBy(
    operation,
    "UseApiMutationOptions",
    `${context.importPrefix}/client`,
  );
  addImportBy(
    operation,
    "UseApiQueryOptions",
    `${context.importPrefix}/client`,
  );

  const { queryKey } = operation;
  return `const queryClient = useQueryClient();
  return useApiMutation({
    mutationKey: [${queryKey.join(", ")}],
    mutationFn: async (): Promise<void> => delete_(${
    buildPath(operation.path, context)
  }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [${queryKey[0]}] });
    },
    ...options,
  });`;
};

const buildListHookFnBody = (
  operation: Operation,
  context: Context,
): string => {
  const { queryKey, responseSchema } = operation;
  addImportBy(
    operation,
    "useApiCollectionQuery",
    `${context.importPrefix}/client`,
  );
  addImportBy(
    operation,
    responseSchema!.zodName,
    `${context.importPrefix}/schemas/${responseSchema!.zodName}`,
  );

  return `return useApiCollectionQuery({
    queryKey: [${queryKey.join(", ")}],
    path: ${buildPath(operation.path, context, operation)},
    schema: ${responseSchema!.zodName},
    ...options,
  });`;
};

const buildHookFnBody = (operation: Operation, context: Context): string => {
  const { entityName, parameters, hook: { type } } = operation;
  operation.queryKey = [
    `"${plural(lcFirst(entityName))}"`,
    ...(parameters ?? []).map((param: Parameter) => param.tsName),
  ];

  if (type === "create") return buildCreateHookFnBody(operation, context);
  if (type === "update") return buildUpdateHookFnBody(operation, context);
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
  const hooks: Array<string> = operations
    .filter((operation) => {
      if (operation.method === "get" && !operation.responseSchema) return false; // Weird case of GET endpoint not returning data
      return true;
    })
    .map((operation) => {
      const { method, path, hook, parameters, requestSchema, responseSchema } =
        operation;
      const { name: hookName, desc } = hook;

      const args = [
        ...(parameters ?? []).map((param: Parameter) =>
          `  ${param.hookArgStr},`
        ),
        ...(requestSchema
          ? [
            `  form: ${
              addImportBy(operation, "UseFormReturn", "react-hook-form")
            }UseFormReturn<${requestSchema.name}>,`,
          ]
          : []), // SROB imports
        `  options: Partial<${
          method === "get"
            ? `${
              addImportBy(
                operation,
                "UseApiQueryOptions",
                `${context.importPrefix}/client`,
              )
            }UseApiQueryOptions<TQueryKey, typeof ${responseSchema?.zodName}>`
            : `${
              addImportBy(
                operation,
                "UseApiMutationOptions",
                `${context.importPrefix}/client`,
              )
            }UseApiMutationOptions<any, any, any>`
        }> = {},`,
      ].join("\n");

      const body = `/**
 * ${desc}
 * Endpoint: ${method.toUpperCase()} ${path}
 * API Platform id : ${operation.operationId}
 */
export function ${hookName}<TQueryKey extends ${// SROB Déplacer la signature dans chaque stratégie, ce sera plus clean
        addImportBy(operation, "QueryKey", `@tanstack/react-query`)
      }QueryKey>(
${args}
) {
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
