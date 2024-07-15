import { addImportBy, buildImports } from "./imports.ts";
import { Context, Property, Schema } from "./types.ts";
import { toJsObjKey, ucFirst } from "./utils.ts";

export type OpenApiSchema = {
  $ref?: string;
  properties?: Record<string, any>;
};

export const buildSchemaName = (schema: OpenApiSchema): string => {
  if (schema["$ref"]) {
    const m = schema["$ref"].match(
      /^#.+\/(?<name>\w+)(\.(?<dto>\w+))?\.jsonld(?:-(?<group>\w+(?:\.\w+)*))?$/,
    );
    if (!m) {
      console.error(schema);
      throw new Error(`Wrong RegExp`);
    }

    // console.log({ m });
    const { name, dto, group } = m.groups!;
    const groups = (group?.split(".") ?? []).map((g: string) =>
      g.replaceAll(
        /[^A-Za-z]([a-z])/g,
        (_: string, m: string) => m.toUpperCase(),
      )
    );

    if (name.toLowerCase() === groups[0]?.toLowerCase()) groups.shift();

    if (name && groups.length) return `${name}${groups.map(ucFirst).join("")}`;
    if (dto) return dto;
    if (name) return name;
  }

  console.error(schema);
  throw new Error(`Unhandled schema`);
};

type Type = "string" | "null" | "boolean" | "integer" | "number" | "array";
export type PropDef = {
  required: boolean;
  entityName: string;
  $ref?: string;
  type?: Type | Array<Type>;
  format?: string;
  anyOf?: Array<PropDef>;
  allOf?: Array<PropDef>;
  items: PropDef;
};

const zodSchemaPropCode = (
  propName: string,
  propDef: PropDef,
  context: Context,
  rootPropDef: PropDef = propDef,
): string => {
  const iriRef = propDef.format === "iri-reference"
    ? `/* 🔗 IRI reference */`
    : "";

  const zodDef = propName === "@type"
    ? `z.literal("${propDef.entityName}")`
    : propDef.type === "string" && propDef.required
    ? `z.string()${iriRef}`
    : propDef.type?.includes?.("string") && propDef.type.includes?.("null")
    ? `z.string().nullable()${iriRef}`
    : propDef.type === "string" && propDef.format === "ulid"
    ? `z.string().ulid()${iriRef}`
    : propDef.type === "string"
    ? `z.string().optional()${iriRef}`
    : propDef.type === "null"
    ? `z.null()`
    : propDef.type?.includes?.("boolean") && propDef.type.includes?.("null")
    ? `z.boolean().nullable()`
    : propDef.type === "boolean"
    ? `z.boolean()`
    : propDef.type === "number"
    ? `z.number()`
    : propDef.type?.includes?.("integer") && propDef.type.includes?.("null")
    ? `z.number().nullable()`
    : propDef.type === "integer"
    ? `z.number()`
    : propDef.anyOf
    ? `z.union([${
      propDef.anyOf.map((subDef: PropDef) =>
        zodSchemaPropCode(propName, subDef, context, rootPropDef)
      ).join(", ")
    }])`
    : propDef.allOf
    ? `z.union([${
      propDef.allOf.map((subDef: PropDef) =>
        zodSchemaPropCode(propName, subDef, context, rootPropDef)
      ).join(", ")
    }])`
    : propDef.type === "array"
    ? `z.array(${
      zodSchemaPropCode(propName, propDef.items, context, rootPropDef)
    })`
    : propDef.$ref
    ? (() => {
      const zodSchemaName = `${buildSchemaName(propDef)}Schema`;
      addImportBy(
        rootPropDef,
        zodSchemaName,
        `${context.importPrefix}/schemas/${zodSchemaName}`,
      );
      return `z.lazy(() => ${zodSchemaName})`;
    })()
    : (() => {
      console.error("Unhandled type", { propName, propDef });
      throw new Error("Unhandled type");
    })();

  return zodDef;
};

const typescriptPropCode = (
  propName: string,
  propDef: PropDef,
  context: Context,
  rootPropDef: PropDef = propDef,
): string => {
  return propDef.anyOf
    ? propDef.anyOf.map((subDef: PropDef) =>
      typescriptPropCode(propName, subDef, context, rootPropDef)
    ).join(" | ")
    : propDef.type === "array"
    ? `Array<${
      typescriptPropCode(propName, propDef.items, context, rootPropDef)
    }>`
    : propDef.type === "null"
    ? `null`
    : propDef.$ref
    ? (() => {
      const schemaName = buildSchemaName(propDef);
      addImportBy(
        rootPropDef,
        schemaName,
        `${context.importPrefix}/schemas/${schemaName}Schema`,
      );
      return schemaName;
    })()
    : (() => {
      console.error("Unhandled type", { propName, propDef });
      throw new Error("Unhandled type");
      // return `(TODO Unhandled type)`;
    })();
};

const zodSchemaPropLine = (
  propName: string,
  propDef: PropDef,
  context: Context,
) => {
  return `${toJsObjKey(propName)}: ${
    zodSchemaPropCode(propName, propDef, context)
  }`;
};

export const buildSchemaProperty = (
  propName: string,
  propDef: PropDef,
  context: Context,
  parentSchema: Schema,
  propsPath: Array<string>,
) => {
  console.log(`Building schema property ${parentSchema.name}.${propName}`);

  const propsPathKey = `${parentSchema.name}.${propName}`;
  if (propsPath.includes(propsPathKey)) {
    console.log(`Property ${propsPathKey} is recursive`);
    parentSchema.propertiesByName[propName].isRecursive = true;
    parentSchema.hasRecursiveProp = true;
    return;
  }

  const property: Property = parentSchema.propertiesByName[propName] = {
    name: propName,
    zodPropCode: "",
    propDef,
  };

  // Also analyze sub-schema, if any, to prepare them for generation
  for (
    const subPropDef of [
      propDef,
      propDef.items,
      ...(propDef.anyOf ?? []),
    ].filter((v) => (!!v?.$ref)) // Analyze only refs, not basic types like {type: "null"}
  ) {
    analyzeOpenApiSchema(subPropDef, "", context, [...propsPath, propsPathKey]);
  }

  property.zodPropCode = zodSchemaPropLine(
    propName,
    propDef,
    context,
  );
};

export const buildSchemaByRef = (
  $ref: string,
  name: string,
  description: string,
  context: Context,
  propsPath: Array<string>,
): Schema => {
  console.log(`Building Zod schema ${name} from ref ${$ref}`);

  const zodName: `${string}Schema` = `${name}Schema`;

  // Schemas are possibly recursive, so setting a placeholder is a good way to prevent an infinite recursion
  const schema: Schema = context.schemasByName[name] ??= {
    name,
    zodName,
    description,
    ref: $ref,
    propertiesByName: {},
  };

  const openApiSchema = $ref
    .replace(/^#/, "").split("/").filter(Boolean)
    .reduce((acc, v) => acc[v], context.apiDoc);

  const entityName = $ref.match(/^.+\/(\w+)/)?.[1] ?? "TODO EntityName"; // TODO It could be undefined!

  for (
    const [propName, propDef] of Object.entries(
      (openApiSchema.properties ?? {}) as { [propName: string]: PropDef },
    )
  ) {
    if (["@context"].includes(propName)) continue; // Filter out some properties

    // Additional useful info which are not well placed in the openAPI doc
    propDef.required = (!openApiSchema.required) ||
      openApiSchema.required.includes(propName);
    propDef.entityName = entityName;

    buildSchemaProperty(
      propName,
      propDef as PropDef,
      context,
      schema,
      propsPath,
    );
  }

  return schema;
};

export const buildSchema = (
  name: string,
  description: string,
  openApiSchema: OpenApiSchema,
  context: Context,
  propsPath: Array<string>,
): Schema => {
  if (openApiSchema.$ref) {
    return buildSchemaByRef(
      openApiSchema.$ref,
      name,
      description,
      context,
      propsPath,
    );
  }

  console.error({ name, description, openApiSchema });
  throw new Error("Unhandled schema definition");
};

export function analyzeOpenApiSchema(
  openApiSchema: OpenApiSchema,
  description: string,
  context: Context,
  propsPath: Array<string> = [], // Used for recursive schemas handling
) {
  console.log(`Analyzing openApi schema`, openApiSchema);

  if (openApiSchema.properties?.["hydra:member"]?.items) {
    // This is a collection, let's analyze its individual items
    return analyzeOpenApiSchema(
      openApiSchema.properties?.["hydra:member"].items,
      `Item for ${description}`,
      context,
      propsPath,
    );
  }

  const name = buildSchemaName(openApiSchema);

  buildSchema(
    name,
    description,
    openApiSchema,
    context,
    propsPath,
  );

  return context.schemasByName[name];
}

const buildRecursiveSchemaCode = (
  schema: Schema,
  context: Context,
) => {
  addImportBy(schema, "ZodType", "zod");
  const { description, zodName, name, propertiesByName } = schema;
  const descriptionStr = description ? `\n/**\n * ${description}\n */` : "";

  const recursivePropsTypesStr = Object.values(propertiesByName)
    .filter((property) => property.isRecursive)
    .map((property) =>
      `${toJsObjKey(property.name)}: ${
        typescriptPropCode(
          property.name,
          property.propDef,
          context,
        )
      };`
    ).join("\n");

  return `${buildImports([schema, ...Object.values(schema.propertiesByName).map(p => p.propDef)], `${context.importPrefix}/schemas/${schema.zodName}`)}

// 🤖 This file has been autogenerated from ${context.apiDocUrl} 🤖

// This schema is recursive, so it is split between non-recursive and recursive parts.
// See https://zod.dev/?id=recursive-types

const BaseSchema = z.object({
  // The non-recursive parts of the schema
  ${
    Object.values(propertiesByName)
      .filter((property) => !property.isRecursive)
      .map((property) => `${property.zodPropCode},`).join(`
  `)
  }
});
${descriptionStr}
export type ${name} = z.infer<typeof BaseSchema> & {
  // Define manually the recursive parts' types
  ${recursivePropsTypesStr}
};
${descriptionStr}
export const ${zodName}: ZodType<${name}> = BaseSchema.extend({
  // The recursive parts of the schema
  ${
    Object.values(propertiesByName)
      .filter((property) => property.isRecursive)
      .map((property) => `${property.zodPropCode},`).join(`
  `)
  }
});
`;
};

const buildNonRecursiveSchemaCode = (
  schema: Schema,
  context: Context,
) => {
  const { zodName, name, propertiesByName, description } = schema;
  const descriptionStr = description ? `\n/**\n * ${description}\n */` : "";

  return `${buildImports([schema, ...Object.values(schema.propertiesByName).map(p => p.propDef)], `${context.importPrefix}/schemas/${schema.zodName}`)}

// 🤖 This file has been autogenerated from ${context.apiDocUrl} 🤖
${descriptionStr}
export const ${zodName} = z.object({
  ${
    Object.values(propertiesByName).map((property) =>
      `${property.zodPropCode},`
    ).join(`
  `)
  }
});

export type ${name} = z.infer<typeof ${zodName}>;
`;
};

const buildSchemaCode = (schema: Schema, context: Context) => {
  const { hasRecursiveProp } = schema;

  addImportBy(schema, "z", "zod");
  return hasRecursiveProp
    ? buildRecursiveSchemaCode(schema, context)
    : buildNonRecursiveSchemaCode(schema, context);
};

export function buildSchemasCode(context: Context) {
  const { schemasByName } = context;

  const schemasCodeByPath = Object.fromEntries(
    Object.values(schemasByName).map((schema) => {
      const path = `${context.outputPath}/schemas/${schema.zodName}.ts`;
      const code = buildSchemaCode(schema, context);
      return [path, code];
    }),
  );

  context.schemasCode = schemasCodeByPath;
}
