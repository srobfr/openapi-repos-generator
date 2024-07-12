import { PropDef } from "./schema.ts";

export type Operation = Record<string, any> & {
  operationId: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  responseSchema?: Schema;
  requestSchema?: Schema;
  cantGenerateReason?: string;
  parameters?: Array<Parameter>;
};

export type Property = {
  name: string;
  propDef: PropDef;
  zodPropCode: string;
  isRecursive?: boolean;
};

export type Schema = {
  name: string;
  zodName: `${string}Schema`;
  ref?: string;
  description: string;
  propertiesByName: { [propName: string]: Property };
  hasRecursiveProp?: boolean;
};

export type Parameter = {
  in: "query" | "path";
  tsName: string;
  schema: Record<string, any>;
  required: boolean;
  hookArgStr: string;
} & Record<string, any>;

export type Context = {
  apiDocUrl: string;
  outputPath: string;
  operationsSelector: RegExp;
  importPrefix: string;

  apiDoc: any;

  operations: Array<Operation>;
  schemasByName: { [name: string]: Schema };

  repositoriesCode: { [path: string]: string };
  schemasCode: { [path: string]: string };
};
