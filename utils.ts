import pluralize from "npm:pluralize@8.0.0";
import { Context } from "./types.ts";

export const lcFirst = (text: string) =>
  text.replace(/^[A-Z]+/, (m: string) => m.toLowerCase());

export const ucFirst = (text: string) =>
  text.replace(/^[a-z]/, (m: string) => m.toUpperCase());

export const pascalCase = (text: string) =>
  Array.from(text.split(/[^a-z\d]+(?=[a-z]|$)/i))
    .filter(Boolean)
    .map(ucFirst)
    .join("");

export const plural = (text: string) => pluralize.plural(text);
export const singular = (text: string) => {
  const sing = pluralize.singular(text);
  // Some special cases that the pluralize lib can't handle
  if (sing === "skus") return "sku";
  return sing;
};

export const toJsIdentifier = (text: string) =>
  text
    .replace(/(\w+)\[\]$/, (_, m) => plural(m)) // "Foo[]" => "Foos"
    .replaceAll(/[^\w]+(\w)/g, (_, m) => m.toUpperCase())
    .replaceAll(/[^\w]+/g, "");

export const toJsObjKey = (text: string) =>
  text.match(/^[a-z]\w*/i) ? text : JSON.stringify(text);

export const apiPlatformTypeToTypescript = (type: any) =>
  type === "integer" ? "number" : type;

export const importFromZodSchemaName = (
  zodSchemaName: string,
  context: Context,
  tsType: boolean = false,
) =>
  `import { ${
    tsType ? `${zodSchemaName.replace(/Schema$/, "")}, ` : ""
  }${zodSchemaName} } from "${context.importPrefix}/schemas/${zodSchemaName}";`;
